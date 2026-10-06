import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const APP_DIR = join(__dirname, '..')
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout
}
let work: string
test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-wtn-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('merge of a worktree whose work is uncommitted: explained, blocked, and never discards it', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  const wt = join(work, 'repo-feat')
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', wt)
  writeFileSync(join(wt, 'a.txt'), 'uncommitted work\n')
  writeFileSync(join(wt, 'new.txt'), 'new file\n')
  const mainBefore = git(repo, 'rev-parse', 'main')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, wt], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()

  // Nothing committed: the bar and the Worktrees list say so up front.
  await expect(page.getByTestId('bar-nothing-to-merge')).toContainText('Nothing committed to merge into main')
  await expect(page.getByTestId('bar-nothing-to-merge')).toContainText('2 uncommitted changes')
  await page.getByTestId('stripe-worktrees').click()
  const featRow = page.getByTestId('worktree-row').filter({ hasText: 'repo-feat' })
  await expect(featRow.getByTestId('wt-nothing-to-merge')).toContainText('nothing committed to merge')
  await expect(featRow.getByTestId('wt-merge')).toHaveCount(0)

  // The dialog says so too, Merge is disabled, cleanup is unavailable.
  await page.getByTestId('bar-merge').click()
  await expect(page.getByTestId('wt-merge-nothing')).toContainText('Nothing to merge')
  await expect(page.getByTestId('wt-merge-nothing')).toContainText('2 uncommitted changes')
  await expect(page.getByTestId('wt-merge-confirm')).toBeDisabled()
  await expect(page.getByTestId('wt-merge-cleanup')).toBeDisabled()
  await page.screenshot({ path: join(__dirname, '..', 'test-results', 'wtn-dialog.png') })

  // "Commit changes…" jumps to this worktree's Commit view.
  await page.getByTestId('wt-merge-commit-first').click()
  await expect(page.getByTestId('stripe-commit')).toHaveClass(/bg-hover/)

  // Commit part of the work; the rest stays uncommitted.
  git(wt, 'add', 'a.txt')
  git(wt, 'commit', '-q', '-m', 'feature commit')
  await page.getByTestId('stripe-log').click()
  await expect(page.getByTestId('bar-nothing-to-merge')).toHaveCount(0)
  await page.getByTestId('bar-merge').click()
  await expect(page.getByTestId('wt-merge-count')).toContainText('1 commit')
  await expect(page.getByTestId('wt-merge-cleanup')).toBeDisabled()
  await page.getByTestId('wt-merge-confirm').click()

  // Merged; the worktree and its uncommitted file are kept, with a message saying why.
  await expect(page.getByText(/Merged 1 commit of feat into main/)).toBeVisible()
  await expect(page.getByText(/The worktree was kept/)).toBeVisible()
  expect(git(repo, 'rev-parse', 'main')).not.toBe(mainBefore)
  expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('uncommitted work\n')
  expect(existsSync(join(wt, 'new.txt'))).toBe(true)
  expect(git(repo, 'branch', '--list', 'feat').trim()).toContain('feat')
  // Merged back: only the uncommitted file is left, and the bar says nothing committed remains.
  await expect(page.getByTestId('bar-nothing-to-merge')).toContainText('1 uncommitted change')
  await app.close()
})

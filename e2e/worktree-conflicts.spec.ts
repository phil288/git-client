import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-wtc-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('merge a worktree into main with conflicts keeps every commit', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  const wt = join(work, 'repo-feat')
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', wt)
  for (const n of [1, 2, 3]) {
    writeFileSync(join(wt, 'a.txt'), `feature ${n}\n`)
    writeFileSync(join(wt, `f${n}.txt`), `${n}\n`)
    git(wt, 'add', '.')
    git(wt, 'commit', '-q', '-m', `feature ${n}`)
  }
  writeFileSync(join(repo, 'a.txt'), 'main change\n')
  git(repo, 'commit', '-q', '-am', 'main change')
  const featTip = git(repo, 'rev-parse', 'feat').trim()

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, wt], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()

  await page.getByTestId('bar-merge').click()
  await expect(page.getByTestId('wt-merge-cleanup')).toBeChecked()
  await page.getByTestId('wt-merge-confirm').click()

  // The worktree tab switches to "merge unfinished": no Merge / Remove, only Resolve / Open / Abort.
  const bar = page.getByTestId('linked-worktree-bar')
  await expect(bar).toHaveAttribute('data-pending', 'true')
  await expect(bar).toContainText('“Theirs” is feat')
  await expect(page.getByTestId('bar-remove')).toHaveCount(0)
  await expect(page.getByTestId('bar-merge')).toHaveCount(0)
  await page.screenshot({ path: join(__dirname, '..', 'test-results', 'wtc-pending-bar.png') })
  expect(existsSync(wt)).toBe(true)
  expect(git(repo, 'rev-parse', 'feat').trim()).toBe(featTip)
  expect(git(repo, 'status', '--porcelain')).toContain('UU a.txt')

  // Worktrees view: same protection on the row.
  await page.getByTestId('stripe-worktrees').click()
  const row = page.getByTestId('worktree-row').filter({ hasText: 'feat' })
  await expect(row).toContainText('unfinished')
  await expect(row.getByTestId('wt-remove')).toHaveCount(0)
  await expect(row.getByTestId('wt-resolve')).toBeVisible()

  // Abort from the bar: merge gone, branch untouched, normal bar back.
  await page.getByTestId('bar-abort').click()
  await page.getByRole('button', { name: 'Abort Merge' }).click()
  await expect(bar).not.toHaveAttribute('data-pending', 'true')
  expect(git(repo, 'rev-parse', 'feat').trim()).toBe(featTip)
  expect(git(repo, 'status', '--porcelain')).toBe('')

  // Merge again, resolve in the main worktree (CLI), then merge + clean up: all feature commits end in main.
  await page.getByTestId('bar-merge').click()
  await page.getByTestId('wt-merge-confirm').click()
  await expect(bar).toHaveAttribute('data-pending', 'true')
  writeFileSync(join(repo, 'a.txt'), 'resolved\n')
  git(repo, 'add', 'a.txt')
  git(repo, 'commit', '-q', '--no-edit')
  await expect(bar).not.toHaveAttribute('data-pending', 'true', { timeout: 10_000 })
  // Everything is merged now: merging again is refused as "nothing to merge"; Remove cleans up.
  await page.getByTestId('bar-merge').click()
  await expect(page.getByTestId('wt-merge-nothing')).toBeVisible()
  await expect(page.getByTestId('wt-merge-confirm')).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByTestId('bar-remove').click()
  await expect(page.getByTestId('wt-delete-branch')).toBeChecked()
  await page.getByTestId('wt-remove-confirm').click()
  await expect.poll(() => existsSync(wt)).toBe(false)
  await expect.poll(() => git(repo, 'branch', '--list', 'feat').trim()).toBe('')
  expect(spawnSync('git', ['merge-base', '--is-ancestor', featTip, 'main'], { cwd: repo }).status).toBe(0)
  expect(git(repo, 'log', '--format=%s', 'main')).toMatch(/feature 3[\s\S]*feature 2[\s\S]*feature 1/)
  await app.close()
})

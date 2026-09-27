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
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-wt-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('create a worktree, merge it into main with cleanup, force-remove a dirty locked one', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()

  // Create from the Worktrees view; the suggested folder is a sibling <repo>-<slug>.
  await page.getByTestId('stripe-worktrees').click()
  await page.getByTestId('wt-add').click()
  await page.getByTestId('wt-branch-name').fill('feat/e2e')
  const wt = join(work, 'repo-e2e')
  await expect(page.getByTestId('wt-path')).toHaveValue(wt)
  await page.getByTestId('wt-create').click()
  await expect(page.getByTestId('linked-worktree-bar')).toContainText('feat/e2e')
  expect(existsSync(join(wt, 'a.txt'))).toBe(true)

  // Work in the worktree, then merge back into main from its tab and clean up.
  writeFileSync(join(wt, 'b.txt'), 'feature\n')
  git(wt, 'add', '.')
  git(wt, 'commit', '-q', '-m', 'feature')
  // This tab's branches panel marks main as checked out in another (the main) worktree.
  await expect(page.locator('[data-testid="branch-row"][data-ref="refs/heads/main"]').first().getByTestId('branch-worktree')).toBeVisible()
  await expect(page.locator('[data-testid="branch-row"][data-ref="refs/heads/feat/e2e"]').first().getByTestId('branch-worktree')).toHaveCount(0)
  // The commit toolbar's branch picker marks it too.
  await page.getByTestId('stripe-commit').click()
  await page.getByTestId('branch-picker').click()
  await expect(page.getByTestId('branch-picker-item').filter({ hasText: /^main$/ }).getByTestId('branch-picker-worktree')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByTestId('bar-merge').click()
  await expect(page.getByTestId('wt-merge-target')).toHaveValue('main')
  await expect(page.getByTestId('wt-merge-cleanup')).toBeChecked()
  await page.getByTestId('wt-merge-confirm').click()
  await expect.poll(() => existsSync(wt)).toBe(false)
  expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('feature\n')
  await expect.poll(() => git(repo, 'branch', '--list', 'feat/e2e').trim()).toBe('')

  // Dirty + locked worktree: Remove is blocked until Force (-f -f) is ticked.
  const wt2 = join(work, 'repo-dirty')
  git(repo, 'worktree', 'add', '-q', '-b', 'dirty', wt2)
  git(repo, 'worktree', 'lock', wt2)
  writeFileSync(join(wt2, 'scratch.txt'), 'x')
  await page.getByTestId('stripe-worktrees').click()
  await page.getByTitle('Refresh').click()
  const row = page.getByTestId('worktree-row').filter({ hasText: 'dirty' })
  await expect(row).toContainText('locked')
  await row.getByTestId('wt-remove').click()
  const confirmBtn = page.getByTestId('wt-remove-confirm')
  await expect(confirmBtn).toBeDisabled()
  await page.getByTestId('wt-force').click()
  await confirmBtn.click()
  await expect.poll(() => existsSync(wt2)).toBe(false)
  await expect.poll(() => git(repo, 'branch', '--list', 'dirty').trim()).toBe('')
  await expect(page.getByTestId('worktree-row')).toHaveCount(1)
  await app.close()
})

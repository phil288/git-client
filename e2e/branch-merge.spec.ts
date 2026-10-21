import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const APP_DIR = join(__dirname, '..')
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout
}
function commit(repo: string, file: string, content: string, msg: string): void {
  writeFileSync(join(repo, file), content)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', msg)
}
let work: string
test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-merge-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

/** main with its own commit, feature with two commits of its own. */
function setup(name: string): string {
  const repo = join(work, name)
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  commit(repo, 'a.txt', 'a\n', 'init')
  git(repo, 'checkout', '-q', '-b', 'feature')
  commit(repo, 'f1.txt', '1\n', 'feature one')
  commit(repo, 'f2.txt', '2\n', 'feature two')
  git(repo, 'checkout', '-q', 'main')
  commit(repo, 'm.txt', 'm\n', 'main work')
  return repo
}

async function launch(repo: string, ud: string): Promise<ElectronApplication> {
  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  return electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, ud) } as Record<string, string> })
}

test('merge a branch into the current branch from its right-click menu', async () => {
  const repo = setup('repo-menu')
  const app = await launch(repo, 'ud-menu')
  const page = await app.firstWindow()
  await page.locator('[data-testid="branch-row"][data-ref="refs/heads/feature"]').last().click({ button: 'right' })
  await page.getByTestId('menu-merge').click()
  const dlg = page.getByTestId('merge-dialog')
  await expect(dlg.getByTestId('merge-count')).toContainText('2 commits of ‘feature’ will be merged into ‘main’')
  await dlg.getByTestId('merge-confirm').click()
  await expect.poll(() => git(repo, 'log', '-1', '--format=%P').trim().split(' ').length).toBe(2)
  await expect(page.getByTestId('log-table')).toContainText('Merge branch')
  await app.close()
})

test('toolbar Merge: nothing to merge disables the button', async () => {
  const repo = setup('repo-toolbar')
  git(repo, 'branch', 'old', 'main~1')
  const app = await launch(repo, 'ud-toolbar')
  const page = await app.firstWindow()
  await page.getByTestId('toolbar-merge').click()
  const dlg = page.getByTestId('merge-dialog')
  await expect(dlg.getByTestId('merge-confirm')).toBeDisabled()
  await dlg.getByTestId('merge-source').click()
  await page.getByTestId('merge-source-search').fill('old')
  await page.getByTestId('merge-source-search').press('Enter')
  await expect(dlg.getByTestId('merge-nothing')).toBeVisible()
  await expect(dlg.getByTestId('merge-confirm')).toBeDisabled()
  await app.close()
})

test('merge into a branch that is not checked out: checks it out first', async () => {
  const repo = setup('repo-checkout')
  const app = await launch(repo, 'ud-checkout')
  const page = await app.firstWindow()
  await page.locator('[data-testid="branch-row"][data-ref="refs/heads/feature"]').last().click({ button: 'right' })
  await page.getByTestId('menu-merge-current-into').click()
  const dlg = page.getByTestId('merge-dialog')
  await expect(dlg.getByTestId('merge-where')).toContainText('will be checked out here first')
  await expect(dlg.getByTestId('merge-confirm')).toHaveText('Checkout and Merge')
  await dlg.getByTestId('merge-confirm').click()
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Checkout and Merge' }).click()
  await expect.poll(() => git(repo, 'branch', '--show-current').trim()).toBe('feature')
  await expect.poll(() => git(repo, 'log', '-1', '--format=%P').trim().split(' ').length).toBe(2)
  expect(git(repo, 'merge-base', '--is-ancestor', 'main', 'feature')).toBe('')
  await app.close()
})

test('right-clicking a branch label in the log opens its branch menu', async () => {
  const repo = setup('repo-log')
  const app = await launch(repo, 'ud-log')
  const page = await app.firstWindow()
  await page.locator('[data-testid="ref-label"][data-ref="refs/heads/feature"]').click({ button: 'right' })
  await expect(page.getByTestId('menu-merge')).toContainText('Merge ‘feature’ into ‘main’…')
  await page.getByTestId('menu-merge').click()
  await expect(page.getByTestId('merge-dialog').getByTestId('merge-count')).toContainText('2 commits')
  await app.close()
})

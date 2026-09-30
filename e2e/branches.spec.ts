import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-br-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('select several branches with Ctrl+click and delete them at once', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  for (const b of ['merged-1', 'merged-2', 'keep']) git(repo, 'branch', b)
  git(repo, 'checkout', '-q', '-b', 'unmerged')
  writeFileSync(join(repo, 'u.txt'), 'u\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'unmerged work')
  git(repo, 'checkout', '-q', 'main')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  const row = (name: string) => page.locator(`[data-testid="branch-row"][data-ref="refs/heads/${name}"]`).last()
  await row('merged-1').click()
  await row('merged-2').click({ modifiers: ['Control'] })
  await row('unmerged').click({ modifiers: ['Control'] })
  await expect(page.getByTestId('branches-panel')).toContainText('3 selected')

  await row('merged-2').click({ button: 'right' })
  await page.getByTestId('delete-selected-branches').click()
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete' }).click()
  // "unmerged" needs the force-delete confirmation.
  await expect(page.getByTestId('confirm-dialog')).toContainText('not fully merged')
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Force Delete' }).click()
  // merged-1/2 are gone before the force-delete prompt: wait for the forced delete itself.
  await expect(row('unmerged')).toHaveCount(0)
  await expect.poll(() => git(repo, 'branch', '--format=%(refname:short)').trim().split('\n').sort()).toEqual(['keep', 'main'])
  await app.close()
})

test('switch branch from the Commit view branch picker', async () => {
  const repo = join(work, 'repo-picker')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'branch', 'feature-x')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud-picker') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('stripe-commit').click()
  await expect(page.getByTestId('branch-picker')).toContainText('main')
  await page.getByTestId('branch-picker').click()
  await page.getByTestId('branch-picker-search').fill('feat')
  await page.getByTestId('branch-picker-search').press('Enter')
  await expect(page.getByTestId('branch-picker')).toContainText('feature-x')
  expect(git(repo, 'branch', '--show-current').trim()).toBe('feature-x')
  await app.close()
})

test('stage all files, tracked and unversioned, from the Commit view toolbar', async () => {
  const repo = join(work, 'repo-stage-all')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  writeFileSync(join(repo, 'a.txt'), 'changed\n')
  writeFileSync(join(repo, 'new.txt'), 'new\n')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud-stage-all') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('stripe-commit').click()
  await expect(page.getByTestId('changes-tree')).toContainText('new.txt')
  await page.getByTestId('stage-all').click()
  await expect(page.getByText('2 of 2 staged')).toBeVisible()
  expect(git(repo, 'diff', '--cached', '--name-only').trim().split('\n').sort()).toEqual(['a.txt', 'new.txt'])
  await page.getByTestId('stage-all').click()
  await expect(page.getByText('0 of 2 staged')).toBeVisible()
  await app.close()
})

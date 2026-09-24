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
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-logrefs-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('deleted branches disappear from the log labels', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'branch', 'in-app')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  const table = page.getByTestId('log-table')

  // Deleted from the Branches panel.
  await expect(table).toContainText('in-app')
  await page.locator('[data-testid="branch-row"][data-ref="refs/heads/in-app"]').last().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(table).not.toContainText('in-app')

  // Created and deleted outside the app (loose ref).
  git(repo, 'branch', 'from-cli')
  await expect(table).toContainText('from-cli')
  git(repo, 'branch', '-D', 'from-cli')
  await expect(table).not.toContainText('from-cli')

  // Packed ref deleted outside the app (only packed-refs is rewritten).
  git(repo, 'branch', 'packed-one')
  git(repo, 'pack-refs', '--all')
  await expect(table).toContainText('packed-one')
  git(repo, 'branch', '-D', 'packed-one')
  await expect(table).not.toContainText('packed-one')
  await app.close()
})

test('a deleted branch is dropped from the Branch filter', async () => {
  const repo = join(work, 'repo-filter')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'checkout', '-q', '-b', 'topic')
  writeFileSync(join(repo, 't.txt'), 't\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'topic work')
  git(repo, 'checkout', '-q', 'main')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud-filter') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('filter-branch').click()
  await page.getByRole('dialog').locator('label', { hasText: 'topic' }).getByRole('checkbox').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('filter-branch')).toContainText('topic')

  git(repo, 'branch', '-D', 'topic')
  await expect(page.getByTestId('filter-branch')).not.toContainText('topic')
  await expect(page.getByTestId('log-table')).toContainText('init')
  await app.close()
})

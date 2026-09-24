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
  await expect(row('merged-1')).toHaveCount(0)
  const left = git(repo, 'branch', '--format=%(refname:short)').trim().split('\n').sort()
  expect(left).toEqual(['keep', 'main'])
  await app.close()
})

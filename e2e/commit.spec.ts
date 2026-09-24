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
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-commit-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('stage one hunk and commit it from the Commit view', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'E2E')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  const lines = (f: (i: number) => string) => Array.from({ length: 40 }, (_, i) => f(i + 1)).join('\n') + '\n'
  writeFileSync(join(repo, 'f.txt'), lines((i) => `line ${i}`))
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  writeFileSync(join(repo, 'f.txt'), lines((i) => (i === 2 ? 'EDIT A' : i === 38 ? 'EDIT B' : `line ${i}`)))

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()
  await page.keyboard.press('Control+k')
  await page.getByTestId('changes-tree').getByTestId('file-row').filter({ hasText: 'f.txt' }).click()
  const hunks = page.getByTestId('hunk')
  await expect(hunks).toHaveCount(2)
  // Stage only the second hunk (EDIT B).
  await hunks.nth(1).getByRole('checkbox').click()
  await expect(page.getByTestId('hunk').filter({ hasText: 'staged' }).filter({ hasText: 'EDIT B' })).toHaveCount(1)
  await page.getByTestId('commit-message').fill('Edit B only')
  await page.getByTestId('commit-message').press('Control+Enter')
  await expect(page.getByTestId('commit-message')).toHaveValue('')
  expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('Edit B only')
  expect(git(repo, 'show', 'HEAD:f.txt')).toContain('EDIT B')
  expect(git(repo, 'show', 'HEAD:f.txt')).not.toContain('EDIT A')
  expect(git(repo, 'diff', '--name-only').trim()).toBe('f.txt') // EDIT A still unstaged
  await app.close()
})

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-m7-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('stash and pop from the Stashes view; history and annotate of a file', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
  git(repo, 'commit', '-q', '-am', 'second')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nlocal\n')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()

  // Stash
  await page.getByTestId('stripe-stash').click()
  await page.getByTestId('stash-create').click()
  await page.getByTestId('stash-dialog').getByRole('textbox').fill('wip e2e')
  await page.getByTestId('stash-dialog').getByRole('button', { name: 'Stash' }).click()
  await expect(page.getByTestId('stash-row')).toContainText('wip e2e')
  expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
  await page.getByTestId('stash-pop').click()
  await expect(page.getByTestId('stash-row')).toHaveCount(0)
  expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\ntwo\nlocal\n')

  // History + annotate from the Commit view's context menu.
  await page.getByTestId('stripe-commit').click()
  await page.getByTestId('changes-tree').getByTestId('file-row').filter({ hasText: 'a.txt' }).click({ button: 'right' })
  await page.getByText('Show History').click()
  await expect(page.getByTestId('file-history')).toContainText('second')
  await expect(page.getByTestId('file-history')).toContainText('first')

  await page.getByTestId('stripe-commit').click()
  await page.getByTestId('changes-tree').getByTestId('file-row').filter({ hasText: 'a.txt' }).click({ button: 'right' })
  await page.getByText('Annotate').click()
  const blame = page.getByTestId('blame-view')
  await expect(blame).toContainText('two')
  await expect(blame).toContainText('local')
  await app.close()
})

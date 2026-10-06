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
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-remotes-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('adds a remote with a connection test, edits it, switches protocol and removes it', async () => {
  const origin = join(work, 'origin.git')
  git(work, 'init', '-q', '--bare', '-b', 'main', origin)
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  git(repo, 'push', '-q', origin, 'main')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()

  await page.getByTestId('stripe-remotes').click()
  await expect(page.getByTestId('remotes-empty')).toBeVisible()
  await page.getByTestId('remote-add-empty').click()

  const dlg = page.getByTestId('remote-dialog')
  await expect(dlg.getByTestId('remote-name')).toHaveValue('origin')
  await dlg.getByTestId('remote-url').fill('notaurl')
  await expect(dlg.getByTestId('remote-url-hint')).toContainText('does not look like a Git URL')
  await dlg.getByTestId('remote-url').fill(origin)
  await expect(dlg.getByTestId('remote-url-hint')).toContainText('Local folder')
  await dlg.getByTestId('remote-test-button').click()
  await expect(dlg.getByTestId('remote-test-result')).toContainText('Found 1 branch, default branch main')
  await dlg.getByTestId('remote-save').click()
  await expect(dlg).toBeHidden()

  const card = page.getByTestId('remote-card')
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute('data-name', 'origin')
  // "Fetch after adding" brought in origin/main.
  await expect(card).toContainText('1 remote branch')

  // Duplicate names are refused in the dialog before git is called.
  await page.getByTestId('remote-add').click()
  await expect(dlg.getByTestId('remote-name')).toHaveValue('upstream')
  await dlg.getByTestId('remote-name').fill('origin')
  await expect(dlg.getByTestId('remote-name-error')).toContainText('already exists')
  await expect(dlg.getByTestId('remote-save')).toBeDisabled()
  await page.keyboard.press('Escape')

  // Edit: point at a GitHub SSH URL with a separate push URL, then switch to HTTPS.
  await card.getByTestId('remote-edit-button').click()
  await dlg.getByTestId('remote-url').fill('git@github.com:owner/repo.git')
  await expect(dlg.getByTestId('remote-url-hint')).toContainText('GitHub · SSH · owner/repo')
  await dlg.getByTestId('remote-separate-push').click()
  await dlg.getByTestId('remote-push-url').fill('git@github.com:me/repo.git')
  await dlg.getByTestId('remote-save').click()
  await expect(dlg).toBeHidden()
  await expect(card.getByTestId('remote-fetch-url')).toHaveText('git@github.com:owner/repo.git')
  await expect(card.getByTestId('remote-push-url')).toHaveText('git@github.com:me/repo.git')
  await expect(card).toContainText('GitHub')
  expect(git(repo, 'config', 'remote.origin.pushurl').trim()).toBe('git@github.com:me/repo.git')

  await card.getByTestId('remote-more').click()
  await page.getByTestId('remote-switch').click()
  await expect(card.getByTestId('remote-fetch-url')).toHaveText('https://github.com/owner/repo.git')
  expect(git(repo, 'config', 'remote.origin.url').trim()).toBe('https://github.com/owner/repo.git')

  // Remove (confirmed).
  await card.getByTestId('remote-more').click()
  await page.getByTestId('remote-remove').click()
  await page.getByRole('button', { name: 'Remove Remote' }).click()
  await expect(page.getByTestId('remotes-empty')).toBeVisible()
  expect(git(repo, 'remote').trim()).toBe('')

  await app.close()
})

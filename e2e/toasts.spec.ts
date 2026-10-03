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
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-toast-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('a toast raised while a modal dialog is open can be closed without closing the dialog', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'branch', 'taken')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()
  await page.getByTitle('New branch from the current HEAD').click()
  const dialog = page.getByTestId('new-branch-dialog')
  await dialog.getByLabel('New branch name').fill('taken')
  // The name is well-formed, so Create enables; git then refuses it because it exists.
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Create' }).click()

  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Could not create the branch' })
  await expect(toast).toBeVisible()
  // Radix sets pointer-events:none on <body> while a modal is open; the toast's buttons must opt back in
  // (the toast body stays click-through so it never blocks dialog buttons beneath it).
  await toast.locator('[data-close-button]').click()
  await expect(toast).toHaveCount(0)
  // Clicking the toast is not an "outside click" that dismisses the dialog.
  await expect(dialog).toBeVisible()
  await app.close()
})

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
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-rw-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('reword a non-HEAD commit through the scripted interactive rebase (Electron as sequence editor)', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  for (const n of [1, 2, 3]) {
    writeFileSync(join(repo, `f${n}.txt`), `${n}\n`)
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', `c${n}`)
  }
  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({
    args: [APP_DIR, ...extra, repo],
    env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string>
  })
  const page = await app.firstWindow()
  const row = page.getByTestId('log-row').filter({ hasText: 'c2' })
  await row.click({ button: 'right' })
  await page.getByText('Edit Commit Message…').click()
  const editor = page.getByTestId('message-dialog').locator('textarea')
  await editor.fill('c2 reworded from the UI')
  await page.getByRole('button', { name: 'Reword' }).click()
  await expect(page.getByTestId('log-row').filter({ hasText: 'c2 reworded from the UI' })).toHaveCount(1)
  expect(git(repo, 'log', '--format=%s').trim().split('\n')).toEqual(['c3', 'c2 reworded from the UI', 'c1'])
  // Backup ref exists, and Undo restores the original history.
  await page.getByTestId('git-menu').click()
  await page.getByText('Undo Last Operation').click()
  await expect(page.getByTestId('log-row').getByText('c2', { exact: true })).toHaveCount(1)
  expect(git(repo, 'log', '--format=%s').trim().split('\n')).toEqual(['c3', 'c2', 'c1'])
  await app.close()
})

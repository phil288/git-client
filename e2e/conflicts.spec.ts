import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const APP_DIR = join(__dirname, '..')
function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' })
  return { ok: r.status === 0, out: r.stdout }
}
let work: string
test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-cf-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

function diverged(name: string): string {
  const r = join(work, name)
  mkdirSync(r)
  git(r, 'init', '-q', '-b', 'main')
  git(r, 'config', 'user.name', 'E2E')
  git(r, 'config', 'user.email', 'e2e@example.com')
  writeFileSync(join(r, 'app.txt'), 'line 1\nline 2\nline 3\n')
  git(r, 'add', '.')
  git(r, 'commit', '-q', '-m', 'base')
  git(r, 'checkout', '-q', '-b', 'feature/x')
  writeFileSync(join(r, 'app.txt'), 'line 1\nline 2 feature\nline 3\n')
  git(r, 'commit', '-q', '-am', 'Fix login')
  git(r, 'checkout', '-q', 'main')
  writeFileSync(join(r, 'app.txt'), 'line 1\nline 2 main\nline 3\n')
  git(r, 'commit', '-q', '-am', 'Main change')
  return r
}

test('rebase conflict: labels, 3-way merge editor, save, continue', async () => {
  const repo = diverged('rebase')
  git(repo, 'checkout', '-q', 'feature/x')
  expect(git(repo, 'rebase', 'main').ok).toBe(false)

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  await expect(page.getByTestId('operation-banner')).toContainText('Rebasing feature/x onto main')
  await expect(page.getByTestId('operation-banner')).toContainText('1 conflicted file')
  await page.getByTestId('banner-resolve').click()

  const dlg = page.getByTestId('conflicts-dialog')
  await expect(dlg.getByTestId('conflict-sides')).toContainText('Yours: main (upstream)')
  await expect(dlg.getByTestId('conflict-sides')).toContainText("Theirs: feature/x (your commit 'Fix login')")
  await dlg.getByTestId('conflict-row').first().click()
  await dlg.getByTestId('merge-button').click()

  const ed = page.getByTestId('merge-editor')
  await expect(ed.getByTestId('merge-counter')).toContainText('1 conflict')
  // Apply Yours then Theirs from the gutters: both lines end up in the result.
  await ed.getByTestId('apply-left-0').click()
  await ed.getByTestId('apply-right-0').click()
  await expect(ed.getByTestId('merge-counter')).toContainText('0 conflicts')
  await ed.getByTestId('merge-save').click()

  await expect(page.getByTestId('all-resolved')).toBeVisible()
  await page.getByTestId('continue-op').click()
  await expect(page.getByTestId('operation-banner')).toHaveCount(0)
  expect(readFileSync(join(repo, 'app.txt'), 'utf8')).toBe('line 1\nline 2 main\nline 2 feature\nline 3\n')
  expect(git(repo, 'log', '--format=%s', '-3').out.trim().split('\n')).toEqual(['Fix login', 'Main change', 'base'])
  await app.close()
})

test('merge conflict: Accept Theirs from the dialog, commit with the prepared message', async () => {
  const repo = diverged('merge')
  expect(git(repo, 'merge', 'feature/x').ok).toBe(false)
  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud2') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('banner-resolve').click()
  const dlg = page.getByTestId('conflicts-dialog')
  await expect(dlg.getByTestId('conflict-sides')).toContainText('Yours: main (current branch)')
  await dlg.getByTestId('conflict-row').first().click()
  await dlg.getByTestId('accept-theirs').click()
  await expect(dlg.getByTestId('continue-message')).toHaveValue(/Merge branch 'feature\/x'/)
  await dlg.getByTestId('continue-op').click()
  await expect(page.getByTestId('operation-banner')).toHaveCount(0)
  expect(git(repo, 'log', '-1', '--format=%s %P').out).toMatch(/^Merge branch 'feature\/x' \w+ \w+/)
  expect(readFileSync(join(repo, 'app.txt'), 'utf8')).toContain('line 2 feature')
  await app.close()
})

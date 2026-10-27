import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const APP_DIR = join(__dirname, '..')
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout
}
/** `git merge` that is expected to stop on conflicts. */
const mergeWithConflicts = (cwd: string, branch: string) =>
  spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'merge', branch], { cwd, encoding: 'utf8' })
let work: string
let fakeCli: string
test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-airesolve-')))
  // Stand-in for the Claude CLI: conflict prompts get both sides kept.
  fakeCli = join(work, 'fake-claude.cjs')
  writeFileSync(
    fakeCli,
    `let s = ''
process.stdin.on('data', (c) => { s += c })
process.stdin.on('end', () => {
  const m = /--- BEGIN FILE ---\\n([\\s\\S]*)\\n--- END FILE ---/.exec(s)
  const out = []
  let mode = null
  for (const l of (m ? m[1] : '').split('\\n')) {
    if (l.startsWith('<<<<<<< ')) mode = 'ours'
    else if (l.startsWith('||||||| ')) mode = 'base'
    else if (l === '=======') mode = 'theirs'
    else if (l.startsWith('>>>>>>> ')) mode = null
    else if (mode !== 'base') out.push(l)
  }
  process.stdout.write(out.join('\\n'))
})
`
  )
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('Resolve with AI on an open merge: Markdown kept both, code resolved by the AI, merge left to continue', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'E2E')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 1\n')
  writeFileSync(join(repo, 'notes.md'), '# Notes\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  git(repo, 'checkout', '-q', '-b', 'feat')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 3\n')
  writeFileSync(join(repo, 'notes.md'), '# Notes\nfrom feat\n')
  git(repo, 'commit', '-q', '-am', 'feat work')
  git(repo, 'checkout', '-q', 'main')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 2\n')
  writeFileSync(join(repo, 'notes.md'), '# Notes\nfrom main\n')
  git(repo, 'commit', '-q', '-am', 'main work')
  mergeWithConflicts(repo, 'feat')
  expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true)

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({
    args: [APP_DIR, ...extra, repo],
    env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud'), GITCLIENT_AI_CLAUDE_PATH: fakeCli, GITCLIENT_AI_NO_PATH_SEARCH: '1' } as Record<string, string>
  })
  const page = await app.firstWindow()
  const banner = page.getByTestId('operation-banner')
  await expect(banner).toContainText('2 conflicted files')

  await page.getByTestId('banner-ai-resolve').click()
  await expect(page.getByText(/Resolved by AI \(worth a review\): app\.ts/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('banner-continue')).toBeEnabled()
  expect(readFileSync(join(repo, 'notes.md'), 'utf8')).toBe('# Notes\nfrom main\nfrom feat\n')
  expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('export const a = 2\nexport const a = 3\n')
  expect(git(repo, 'diff', '--name-only', '--diff-filter=U').trim()).toBe('')
  // The merge itself stays open for the user.
  expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true)
  await app.close()
})

test('Resolve with AI from the Conflicts dialog', async () => {
  const repo = join(work, 'repo2')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'E2E')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 1\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  git(repo, 'checkout', '-q', '-b', 'feat')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 3\n')
  git(repo, 'commit', '-q', '-am', 'feat work')
  git(repo, 'checkout', '-q', 'main')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 2\n')
  git(repo, 'commit', '-q', '-am', 'main work')
  mergeWithConflicts(repo, 'feat')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({
    args: [APP_DIR, ...extra, repo],
    env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud2'), GITCLIENT_AI_CLAUDE_PATH: fakeCli, GITCLIENT_AI_NO_PATH_SEARCH: '1' } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.getByTestId('banner-resolve').click()
  const dialog = page.getByTestId('conflicts-dialog')
  await expect(dialog.getByTestId('conflict-row')).toHaveCount(1)
  await dialog.getByTestId('ai-resolve').click()
  await expect(dialog.getByTestId('all-resolved')).toBeVisible({ timeout: 20_000 })
  expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('export const a = 2\nexport const a = 3\n')
  await app.close()
})

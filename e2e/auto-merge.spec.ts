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
let work: string
let fakeCli: string
test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-auto-')))
  // Stand-in for the Claude CLI: commit prompts get a fixed message, conflict prompts get both sides kept.
  fakeCli = join(work, 'fake-claude.cjs')
  writeFileSync(
    fakeCli,
    `let s = ''
process.stdin.on('data', (c) => { s += c })
process.stdin.on('end', () => {
  const m = /--- BEGIN FILE ---\\n([\\s\\S]*)\\n--- END FILE ---/.exec(s)
  if (!m) { process.stdout.write('feat: finish the feature\\n'); return }
  const out = []
  let mode = null
  for (const l of m[1].split('\\n')) {
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

test('Auto Merge: commits, waits for a clean main, resolves conflicts and removes the worktree', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'E2E')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 1\n')
  writeFileSync(join(repo, 'notes.md'), '# Notes\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  const wt = join(work, 'repo-feat')
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', wt)
  writeFileSync(join(wt, 'app.ts'), 'export const a = 3\n')
  git(wt, 'commit', '-q', '-am', 'feat: a = 3')
  writeFileSync(join(wt, 'notes.md'), '# Notes\nfrom feat\n') // left uncommitted: Auto Merge commits it
  writeFileSync(join(repo, 'app.ts'), 'export const a = 2\n')
  writeFileSync(join(repo, 'notes.md'), '# Notes\nfrom main\n')
  git(repo, 'commit', '-q', '-am', 'main work')
  writeFileSync(join(repo, 'scratch.txt'), 'wip\n') // main is not clean

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({
    args: [APP_DIR, ...extra, wt],
    env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud'), GITCLIENT_AI_CLAUDE_PATH: fakeCli, GITCLIENT_AI_NO_PATH_SEARCH: '1' } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()

  await page.getByTestId('bar-auto-merge').click()
  const dialog = page.getByTestId('auto-merge-dialog')
  await expect(dialog).toHaveAttribute('data-phase', 'blocked', { timeout: 20_000 })
  await expect(page.getByTestId('auto-merge-dirty')).toContainText('scratch.txt')
  expect(git(wt, 'log', '-1', '--format=%s').trim()).toBe('feat: finish the feature')
  expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)

  // Cleaning main resumes on its own.
  rmSync(join(repo, 'scratch.txt'))
  await expect(dialog).toHaveCount(0, { timeout: 30_000 })
  await expect.poll(() => existsSync(wt)).toBe(false)
  await expect.poll(() => git(repo, 'branch', '--list', 'feat').trim()).toBe('')
  expect(readFileSync(join(repo, 'notes.md'), 'utf8')).toBe('# Notes\nfrom main\nfrom feat\n')
  expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('export const a = 2\nexport const a = 3\n')
  expect(git(repo, 'status', '--porcelain')).toBe('')
  expect(git(repo, 'log', '-1', '--format=%P', 'main').trim().split(' ')).toHaveLength(2)
  await expect(page.getByText(/Resolved by AI \(worth a review\): app\.ts/)).toBeVisible()
  await app.close()
})

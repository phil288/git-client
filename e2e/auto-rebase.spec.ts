import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const APP_DIR = join(__dirname, '..')
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout
}
const rebasing = (repo: string) => existsSync(join(repo, '.git', 'rebase-merge')) || existsSync(join(repo, '.git', 'rebase-apply'))
let work: string
let fakeCli: string
test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-autorebase-')))
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

/** feat (checked out) has two commits, each conflicting with main: one in app.ts, one in notes.md. */
function setup(name: string): string {
  const repo = join(work, name)
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
  git(repo, 'commit', '-q', '-am', 'feat code')
  writeFileSync(join(repo, 'notes.md'), '# Notes\nfrom feat\n')
  git(repo, 'commit', '-q', '-am', 'feat notes')
  git(repo, 'checkout', '-q', 'main')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 2\n')
  writeFileSync(join(repo, 'notes.md'), '# Notes\nfrom main\n')
  git(repo, 'commit', '-q', '-am', 'main work')
  git(repo, 'checkout', '-q', 'feat')
  return repo
}

function launch(repo: string, ud: string): Promise<ElectronApplication> {
  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  return electron.launch({
    args: [APP_DIR, ...extra, repo],
    env: { ...process.env, GITCLIENT_USER_DATA: join(work, ud), GITCLIENT_AI_CLAUDE_PATH: fakeCli, GITCLIENT_AI_NO_PATH_SEARCH: '1' } as Record<string, string>
  })
}

function expectRebased(repo: string): void {
  expect(rebasing(repo)).toBe(false)
  expect(git(repo, 'log', '--format=%s', 'main..feat').trim().split('\n')).toEqual(['feat notes', 'feat code'])
  expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe('export const a = 2\nexport const a = 3\n')
  expect(readFileSync(join(repo, 'notes.md'), 'utf8')).toBe('# Notes\nfrom main\nfrom feat\n')
}

test('Auto Rebase from the branch menu resolves every step and finishes the rebase', async () => {
  const repo = setup('menu')
  const app = await launch(repo, 'ud-menu')
  const page = await app.firstWindow()
  await page.locator('[data-testid="branch-row"][data-ref="refs/heads/main"]').last().click({ button: 'right' })
  await expect(page.getByTestId('menu-auto-rebase')).toContainText('Auto Rebase ‘feat’ onto ‘main’')
  await page.getByTestId('menu-auto-rebase').click()
  await expect(page.getByText(/Resolved by AI \(worth a review\): app\.ts/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/2 steps with conflicts resolved/)).toBeVisible()
  await expect(page.getByTestId('operation-banner')).toBeHidden()
  expectRebased(repo)
  await app.close()
})

test('Auto Rebase from the banner resumes a rebase stopped on conflicts', async () => {
  const repo = setup('banner')
  spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'rebase', 'main'], { cwd: repo, encoding: 'utf8' })
  expect(rebasing(repo)).toBe(true)
  const app = await launch(repo, 'ud-banner')
  const page = await app.firstWindow()
  await expect(page.getByTestId('operation-banner')).toContainText('1 conflicted file')
  await page.getByTestId('banner-auto-rebase').click()
  await expect(page.getByText(/Rebase of feat finished/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('operation-banner')).toBeHidden()
  expectRebased(repo)
  await app.close()
})

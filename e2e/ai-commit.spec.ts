import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const APP_DIR = join(__dirname, '..')
const GENERATED = 'feat: add greeting\n\nAdds hello.txt.'
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout
}
let work: string
let fakeCli: string
test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-ai-')))
  // Stand-in for the Claude CLI: ignores stdin content and prints a fixed message.
  fakeCli = join(work, 'fake-claude.cjs')
  writeFileSync(
    fakeCli,
    `if (process.env.FAKE_CLI_HANG) { setInterval(() => {}, 1000) } else { process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(GENERATED + '\n')})); process.stdin.on('error', () => {}) }\n`
  )
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

async function launch(name: string, extraEnv: Record<string, string> = {}) {
  const repo = join(work, name)
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'E2E')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  writeFileSync(join(repo, 'hello.txt'), 'hello\n')
  git(repo, 'add', 'hello.txt')
  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({
    args: [APP_DIR, ...extra, repo],
    env: { ...process.env, GITCLIENT_USER_DATA: join(work, `ud-${name}`), GITCLIENT_AI_CLAUDE_PATH: fakeCli, GITCLIENT_AI_NO_PATH_SEARCH: '1', ...extraEnv } as Record<string, string>
  })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('commit-panel')).toBeVisible()
  return { app, page, repo }
}

test('generate a commit message from the staged diff and commit it', async () => {
  const { app, page, repo } = await launch('gen')
  const generate = page.getByTestId('ai-generate')
  await expect(generate).toBeEnabled()
  await generate.click()
  await expect(page.getByTestId('commit-message')).toHaveValue(GENERATED)
  await page.getByTestId('commit-message').press('Control+Enter')
  await expect(page.getByTestId('commit-message')).toHaveValue('')
  expect(git(repo, 'log', '-1', '--format=%B').trim()).toBe(GENERATED)
  await app.close()
})

test('generating over a typed message asks before replacing it', async () => {
  const { app, page } = await launch('confirm')
  await page.getByTestId('commit-message').fill('my own message')
  await page.getByTestId('ai-generate').click()
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
  await expect(dialog.getByText('Replace the current message')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('commit-message')).toHaveValue('my own message')
  await app.close()
})

test('clicking Generate again cancels without an error toast', async () => {
  const { app, page } = await launch('cancel', { FAKE_CLI_HANG: '1' })
  const generate = page.getByTestId('ai-generate')
  await generate.click()
  await expect(generate).toHaveText(/Generating…/)
  await generate.click()
  await expect(generate).toHaveText(/Generate$/)
  await expect(page.getByTestId('commit-message')).toHaveValue('')
  await expect(page.getByText('Could not generate')).toHaveCount(0)
  await app.close()
})

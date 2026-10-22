import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  // Stand-in for the Claude CLI: prints a fixed message; FAKE_CLI_ARGV / FAKE_CLI_STDIN record what it got.
  fakeCli = join(work, 'fake-claude.cjs')
  writeFileSync(
    fakeCli,
    `if (process.env.FAKE_CLI_ARGV) require('node:fs').writeFileSync(process.env.FAKE_CLI_ARGV, JSON.stringify(process.argv.slice(2)))
let stdin = ''
if (process.env.FAKE_CLI_HANG) { setInterval(() => {}, 1000) } else { process.stdin.resume(); process.stdin.on('data', (c) => { stdin += c }); process.stdin.on('end', () => { if (process.env.FAKE_CLI_STDIN) require('node:fs').writeFileSync(process.env.FAKE_CLI_STDIN, stdin); process.stdout.write(${JSON.stringify(GENERATED + '\n')}) }); process.stdin.on('error', () => {}) }\n`
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

async function openSettings(app: Awaited<ReturnType<typeof launch>>['app']): Promise<void> {
  // Native menu accelerators do not see Playwright key presses: click the menu item instead.
  await app.evaluate(({ Menu }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined =>
      items.map((i) => (i.label === 'Settings…' ? i : i.submenu ? find(i.submenu.items) : undefined)).find(Boolean)
    find(Menu.getApplicationMenu()!.items)!.click()
  })
}

test('the model set in Settings is passed to the CLI as --model', async () => {
  const argvFile = join(work, 'model-argv.json')
  const { app, page } = await launch('model', { FAKE_CLI_ARGV: argvFile })
  await openSettings(app)
  const settings = page.getByTestId('settings-dialog')
  await settings.getByTestId('ai-tool-select').selectOption('claude')
  const model = settings.getByTestId('ai-model-input')
  await model.fill('bad model')
  await expect(model).toHaveAttribute('aria-invalid', 'true')
  await model.fill('opus[1m]')
  await expect(model).toHaveAttribute('aria-invalid', 'false')
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  await page.getByTestId('ai-generate').click()
  await expect(page.getByTestId('commit-message')).toHaveValue(GENERATED)
  const argv = JSON.parse(readFileSync(argvFile, 'utf8')) as string[]
  expect(argv.slice(-2)).toEqual(['--model', 'opus[1m]'])
  await app.close()
})

test('custom prompt instructions from Settings replace the built-in ones', async () => {
  const stdinFile = join(work, 'prompt-stdin.txt')
  const { app, page } = await launch('prompt', { FAKE_CLI_STDIN: stdinFile })
  await openSettings(app)
  const settings = page.getByTestId('settings-dialog')
  await settings.getByTestId('ai-instructions-default').click()
  const instructions = settings.getByTestId('ai-instructions-input')
  await expect(instructions).toHaveValue(/Output ONLY the raw commit message/)
  await instructions.fill('Write the commit message in French. zzcustomzz')
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  await page.getByTestId('ai-generate').click()
  await expect(page.getByTestId('commit-message')).toHaveValue(GENERATED)
  const prompt = readFileSync(stdinFile, 'utf8')
  expect(prompt.startsWith('Write the commit message in French. zzcustomzz\n')).toBe(true)
  expect(prompt).not.toContain('Output ONLY the raw commit message')
  expect(prompt).toContain('hello.txt')
  await app.close()
})

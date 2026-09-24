import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

// Launch the project dir so Electron reads package.json (name, version, main).
const APP_DIR = join(__dirname, '..')

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
}

let work: string
let userData: string
let repo: string

test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-')))
  userData = join(work, 'userData')
  repo = join(work, 'demo repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), '# demo\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'initial')
})

test.afterAll(() => rmSync(work, { recursive: true, force: true }))

async function launch(args: string[] = []): Promise<ElectronApplication> {
  // CI runners (and Ubuntu 24.04's AppArmor userns restriction) cannot use the
  // Chromium sandbox with an unprivileged node_modules Electron; tests only.
  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  return electron.launch({
    args: [APP_DIR, ...extra, ...args],
    env: { ...process.env, GITCLIENT_USER_DATA: userData, NODE_ENV: 'production' } as Record<string, string>
  })
}

test('opens a repository passed on the command line as a tab', async () => {
  const app = await launch([repo])
  const page = await app.firstWindow()
  await expect(page.getByTestId('repo-tab')).toHaveCount(1)
  await expect(page.getByTestId('repo-tab')).toContainText('demo repo')
  await expect(page.getByTestId('repo-branch')).toHaveAttribute('data-branch', 'main')
  // Log tab: the commit is listed and selecting it shows details.
  await expect(page.getByTestId('log-row')).toHaveCount(1)
  await page.getByTestId('log-row').first().click()
  await expect(page.getByTestId('commit-details')).toContainText('initial')
  await page.getByTestId('file-row').first().click()
  await expect(page.getByTestId('diff-viewer')).toBeVisible()

  // Security settings of the renderer.
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences() exists at runtime but is not in Electron's typings.
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean }
    }
    const p = wc.getLastWebPreferences()
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }
  })
  expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined')
  expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined')
  await app.close()
})

test('restores the session and lists the repo in Recents', async () => {
  const app = await launch()
  const page = await app.firstWindow()
  // Session restore reopens the tab from the previous run.
  await expect(page.getByTestId('repo-tab')).toHaveCount(1)
  // Close it: the welcome screen appears with the repo in the recent list.
  await page.keyboard.press('Control+W')
  await expect(page.getByTestId('welcome-screen')).toBeVisible()
  await expect(page.getByTestId('recent-item')).toContainText('demo repo')

  // Type-to-search + Enter opens the first match.
  await page.keyboard.type('demo')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('repo-view')).toBeVisible()
  await app.close()
})

test('git commands appear in the Git Console', async () => {
  const app = await launch([repo])
  const page = await app.firstWindow()
  await expect(page.getByTestId('repo-view')).toBeVisible()
  await page.keyboard.press('Alt+9')
  await expect(page.getByTestId('git-console')).toContainText('git rev-parse')
  await app.close()
})

// Captures the README / website screenshots from the built app (run `npm run build` first):
//   node scripts/screenshots.mjs
// Writes PNGs to docs/images/. Both shots use throwaway repositories with fictional authors,
// so no real names or e-mail addresses end up in the images.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'

const APP_DIR = resolve(import.meta.dirname, '..')
const OUT = join(APP_DIR, 'docs', 'images')
const W = 1440, H = 900
const AUTHORS = [['Ada Lovelace', 'ada@example.com'], ['Linus Park', 'linus@example.com'], ['Grace Okafor', 'grace@example.com'], ['Ken Tanaka', 'ken@example.com']]

let clock = Date.parse('2026-09-01T09:00:00Z') / 1000
function git(cwd, args, author = AUTHORS[0]) {
  clock += 3600 * 5
  const env = { ...process.env, GIT_AUTHOR_DATE: `${clock} +0000`, GIT_COMMITTER_DATE: `${clock} +0000` }
  const r = spawnSync('git', ['-c', `user.name=${author[0]}`, '-c', `user.email=${author[1]}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env })
  return r.status === 0
}
function commit(repo, file, content, msg, author) {
  mkdirSync(join(repo, file, '..'), { recursive: true })
  writeFileSync(join(repo, file), content)
  git(repo, ['add', '.'], author)
  git(repo, ['commit', '-q', '-m', msg], author)
}

/** A small web-app history: feature branches, merges, a release tag. */
function demoRepo(dir) {
  const [ada, linus, grace, ken] = AUTHORS
  mkdirSync(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  commit(dir, 'README.md', '# Acme Web\n', 'Initial commit', ada)
  commit(dir, 'src/server.ts', 'export const port = 3000\n', 'Add HTTP server skeleton', ada)
  commit(dir, 'src/db.ts', 'export const pool = createPool()\n', 'Add database pool', linus)
  git(dir, ['tag', '-a', 'v0.1.0', '-m', 'v0.1.0'], ada)
  git(dir, ['checkout', '-q', '-b', 'feature/auth'])
  commit(dir, 'src/auth.ts', 'export function login() {}\n', 'Add login endpoint', grace)
  commit(dir, 'src/auth.ts', 'export function login() {}\nexport function logout() {}\n', 'Add logout endpoint', grace)
  git(dir, ['checkout', '-q', 'main'])
  commit(dir, 'src/server.ts', 'export const port = Number(process.env.PORT ?? 3000)\n', 'Read port from environment', ken)
  git(dir, ['checkout', '-q', '-b', 'fix/pool-timeout'])
  commit(dir, 'src/db.ts', 'export const pool = createPool({ timeout: 5000 })\n', 'Fix connection pool timeout', linus)
  git(dir, ['checkout', '-q', 'main'])
  git(dir, ['merge', '-q', '--no-ff', '-m', "Merge branch 'feature/auth'", 'feature/auth'], ada)
  commit(dir, 'src/auth.ts', 'export function login() {}\nexport function logout() {}\nexport function refresh() {}\n', 'Add token refresh', grace)
  git(dir, ['merge', '-q', '--no-ff', '-m', "Merge branch 'fix/pool-timeout'", 'fix/pool-timeout'], ada)
  commit(dir, 'docs/api.md', '# API\n\n- POST /login\n- POST /logout\n- POST /refresh\n', 'Document auth API', ken)
  git(dir, ['tag', '-a', 'v0.2.0', '-m', 'v0.2.0'], ada)
  git(dir, ['checkout', '-q', '-b', 'feature/dashboard'])
  commit(dir, 'src/dashboard.tsx', 'export function Dashboard() { return null }\n', 'Scaffold dashboard page', ken)
  commit(dir, 'src/dashboard.tsx', 'export function Dashboard() {\n  const stats = useStats()\n  return <Chart data={stats} />\n}\n', 'Render usage chart on dashboard', ken)
  git(dir, ['checkout', '-q', 'main'])
  commit(dir, 'src/server.ts', 'export const port = Number(process.env.PORT ?? 3000)\nexport const host = process.env.HOST ?? "0.0.0.0"\n', 'Bind host from environment', linus)
  commit(dir, 'src/auth.ts', 'export function login() {}\nexport function logout() {}\nexport function refresh() {}\nexport function revoke() {}\n', 'Add token revocation', grace)
  git(dir, ['checkout', '-q', 'feature/dashboard'])
  return dir
}

/**
 * page.screenshot waits for a fresh compositor frame, which sometimes never comes for a static
 * window (Wayland); BrowserWindow.capturePage is the fallback.
 */
async function shot(app, page, file) {
  // A window that is not focused may get no new frames: raise it and force a repaint.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.show()
    win.focus()
    win.webContents.invalidate()
  })
  try {
    await page.screenshot({ path: join(OUT, file), timeout: 10_000 })
  } catch {
    const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
    writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'))
  }
}

/** app.close() can hang after a capture on some compositors; kill the process if it does. */
async function close(app) {
  const done = await Promise.race([app.close().then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))])
  if (!done) app.process().kill('SIGKILL')
}

async function launch(repo, userData, theme) {
  const extra = process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({
    args: [APP_DIR, ...extra, repo],
    env: { ...process.env, GITCLIENT_USER_DATA: userData },
    colorScheme: theme,
  })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.unmaximize()
    win.setContentSize(w, h)
  }, [W, H])
  await page.getByTestId('repo-view').waitFor()
  await page.waitForTimeout(1000)
  return { app, page }
}

const work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-shots-')))
mkdirSync(OUT, { recursive: true })
try {
  const demo = demoRepo(join(work, 'acme-web'))
  for (const theme of ['dark', 'light']) {
    const ud = join(work, `ud-log-${theme}`)
    mkdirSync(ud)
    const { app, page } = await launch(demo, ud, theme)
    await page.getByTestId('log-row').nth(5).waitFor()
    await page.getByTestId('log-row').nth(1).click({ force: true })
    await page.getByTestId('file-row').first().click({ force: true })
    await page.getByTestId('diff-viewer').waitFor()
    await page.waitForTimeout(1500)
    await shot(app, page, `log-${theme}.png`)
    await close(app)
  }

  const repo = join(work, 'acme-api')
  mkdirSync(repo)
  git(repo, ['init', '-q', '-b', 'main'])
  const base = ['export function login(user, password) {', '  const session = createSession(user)', '  session.timeout = 30 * 60', '  return authenticate(session, password)', '}', '']
  commit(repo, 'auth.js', base.join('\n'), 'Add login', AUTHORS[0])
  git(repo, ['checkout', '-q', '-b', 'feature/sso'])
  commit(repo, 'auth.js', base.map((l, i) => (i === 2 ? '  session.timeout = config.sessionTimeout' : l)).join('\n'), 'Read session timeout from config', AUTHORS[2])
  git(repo, ['checkout', '-q', 'main'])
  commit(repo, 'auth.js', base.map((l, i) => (i === 2 ? '  session.timeout = 8 * 60 * 60 // 8 hours' : l)).join('\n'), 'Extend session timeout', AUTHORS[1])
  git(repo, ['checkout', '-q', 'feature/sso'])
  git(repo, ['rebase', 'main'], AUTHORS[2])

  const ud = join(work, 'ud-merge')
  mkdirSync(ud)
  const { app, page } = await launch(repo, ud, 'dark')
  await page.getByTestId('banner-resolve').click({ force: true })
  const dlg = page.getByTestId('conflicts-dialog')
  await dlg.getByTestId('conflict-row').first().click({ force: true })
  await dlg.getByTestId('merge-button').click({ force: true })
  await page.getByTestId('merge-editor').getByTestId('merge-counter').waitFor()
  await page.waitForTimeout(1500)
  await shot(app, page, 'merge-editor-dark.png')
  await close(app)
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`Screenshots written to ${OUT}`)

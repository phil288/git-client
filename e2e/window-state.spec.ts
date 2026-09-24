import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const APP_DIR = join(__dirname, '..')
let work: string
test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-win-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

async function launch(): Promise<ElectronApplication> {
  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  await app.firstWindow()
  return app
}

const isMaximized = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())

test('window reopens with its last size and maximized state', async () => {
  let app = await launch()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ x: 40, y: 40, width: 1000, height: 700 }))
  await app.close()

  app = await launch()
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getNormalBounds())
  expect([size.width, size.height]).toEqual([1000, 700])
  expect(await isMaximized(app)).toBe(false)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize())
  await expect.poll(() => isMaximized(app)).toBe(true)
  await app.close()

  app = await launch()
  await expect.poll(() => isMaximized(app)).toBe(true)
  // Un-maximizing returns to the size chosen before maximizing.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.unmaximize())
  await expect.poll(() => isMaximized(app)).toBe(false)
  const normal = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
  expect([normal.width, normal.height]).toEqual([1000, 700])
  await app.close()
})

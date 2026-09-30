import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const APP_DIR = join(__dirname, '..')

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
}

let work: string
let userData: string
const repos: string[] = []

test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-tabs-')))
  userData = join(work, 'userData')
  for (const name of ['alpha', 'beta', 'gamma']) {
    const repo = join(work, name)
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    writeFileSync(join(repo, 'README.md'), `# ${name}\n`)
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'initial')
    repos.push(repo)
  }
})

test.afterAll(() => rmSync(work, { recursive: true, force: true }))

async function launch(args: string[] = []): Promise<ElectronApplication> {
  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  return electron.launch({
    args: [APP_DIR, ...extra, ...args],
    env: { ...process.env, GITCLIENT_USER_DATA: userData, NODE_ENV: 'production' } as Record<string, string>
  })
}

/** Repo folder names in strip order (innerText also holds the avatar initials). */
const tabNames = (page: Page) =>
  page.getByTestId('repo-tab').evaluateAll((els) => els.map((el) => el.getAttribute('title')!.split('  ')[0]!.split(/[\\/]/).pop()!))

test('tabs can be reordered by drag and drop and pinned', async () => {
  const app = await launch(repos)
  const page = await app.firstWindow()
  const tabs = page.getByTestId('repo-tab')
  await expect(tabs).toHaveCount(3)
  const initial = await tabNames(page)

  // Drop the last tab onto the left half of the first one.
  const first = await tabs.first().boundingBox()
  await tabs.last().dragTo(tabs.first(), { targetPosition: { x: 4, y: first!.height / 2 } })
  await expect.poll(() => tabNames(page)).toEqual([initial[2], initial[0], initial[1]])

  // Pinning the last tab moves it to the front and hides its close button.
  await tabs.last().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin Tab' }).click()
  await expect(tabs.first()).toHaveAttribute('data-pinned', 'true')
  await expect.poll(() => tabNames(page)).toEqual([initial[1], initial[2], initial[0]])
  await expect(tabs.first().getByRole('button', { name: /^Close / })).toHaveCount(0)

  // An unpinned tab cannot be dropped into the pinned group.
  const pinnedBox = await tabs.first().boundingBox()
  await tabs.last().dragTo(tabs.first(), { targetPosition: { x: 4, y: pinnedBox!.height / 2 } })
  await page.waitForTimeout(200)
  expect(await tabNames(page)).toEqual([initial[1], initial[2], initial[0]])

  // "Close Other Tabs" keeps the pinned tab.
  await tabs.nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close Other Tabs' }).click()
  await expect(tabs).toHaveCount(2)
  const kept = await tabNames(page)
  await app.close()

  // Order and pin state survive a restart.
  const again = await launch()
  const page2 = await again.firstWindow()
  await expect(page2.getByTestId('repo-tab')).toHaveCount(2)
  expect(await tabNames(page2)).toEqual(kept)
  await expect(page2.getByTestId('repo-tab').first()).toHaveAttribute('data-pinned', 'true')
  await again.close()
})

test('a tab shows a dot while any of its worktrees has uncommitted changes', async () => {
  const repo = join(work, 'delta')
  const linked = join(work, 'delta-wt')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), '# delta\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'initial')
  git(repo, 'worktree', 'add', '-q', '-b', 'side', linked)
  // Only the linked worktree is dirty; the tab is on the main one.
  writeFileSync(join(linked, 'wip.txt'), 'wip\n')

  const app = await launch([repo])
  const page = await app.firstWindow()
  const tab = page.locator(`[data-testid="repo-tab"][title^="${repo}"]`)
  await expect(tab).toHaveCount(1)
  await expect(tab.getByTestId('repo-tab-dirty')).toBeVisible()

  // Committing in the linked worktree moves a shared ref, which refreshes the dot.
  git(linked, 'add', '.')
  git(linked, 'commit', '-q', '-m', 'wip')
  await expect(tab.getByTestId('repo-tab-dirty')).toHaveCount(0, { timeout: 10_000 })
  await app.close()
})

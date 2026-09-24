import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
test.beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'gitclient-e2e-tags-')))
})
test.afterAll(() => rmSync(work, { recursive: true, force: true }))

test('lists tags by version, compares a tag with the previous one, two tags and a tag with a branch', async () => {
  const repo = join(work, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  const commit = (file: string, msg: string) => {
    writeFileSync(join(repo, file), `${msg}\n`)
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', msg)
  }
  commit('a.txt', 'first')
  git(repo, 'tag', 'v1.9.0')
  commit('b.txt', 'second')
  git(repo, '-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'tag', '-a', 'v1.10.0', '-m', 'Release 1.10')
  commit('c.txt', 'third')
  git(repo, 'checkout', '-q', '-b', 'feature')
  commit('d.txt', 'feature work')
  git(repo, 'checkout', '-q', 'main')

  const extra = process.env.CI || process.env.E2E_NO_SANDBOX ? ['--no-sandbox'] : []
  const app = await electron.launch({ args: [APP_DIR, ...extra, repo], env: { ...process.env, GITCLIENT_USER_DATA: join(work, 'ud') } as Record<string, string> })
  const page = await app.firstWindow()
  await page.getByTestId('log-row').first().waitFor()

  // Version order: v1.10.0 above v1.9.0 (plain string order would be the reverse).
  await page.getByTestId('stripe-tags').click()
  const rows = page.getByTestId('tag-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveAttribute('data-name', 'v1.10.0')
  await expect(rows.nth(1)).toHaveAttribute('data-name', 'v1.9.0')

  // Selected tag is compared with the previous tag by default.
  const details = page.getByTestId('tag-details')
  await expect(details).toContainText('Release 1.10')
  await expect(details.getByTestId('tag-compare-base')).toContainText('v1.9.0')
  await expect(details.getByTestId('compare-tab-a')).toContainText('(1)')
  await expect(details.getByTestId('compare-commits')).toContainText('second')

  // Change the base to a branch.
  await details.getByTestId('tag-compare-base').click()
  await page.getByTestId('tag-compare-base-search').fill('feature')
  await page.getByTestId('ref-select-item').filter({ hasText: 'feature' }).first().click()
  await expect(details.getByTestId('compare-tab-b')).toContainText('(2)')

  // Tick both tags → Compare dialog.
  await rows.nth(0).getByRole('checkbox').click()
  await rows.nth(1).getByRole('checkbox').click()
  await page.getByTestId('tag-compare-selected').click()
  const dialog = page.getByTestId('compare-dialog')
  await expect(dialog).toContainText('Compare ‘v1.10.0’ with ‘v1.9.0’')
  await expect(dialog.getByTestId('compare-tab-a')).toContainText('(1)')
  await dialog.getByTestId('compare-tab-files').click()
  await expect(dialog.getByTestId('file-row')).toContainText('b.txt')

  // Swap, then compare the tag with the main branch instead.
  await dialog.getByTestId('compare-swap').click()
  await expect(dialog).toContainText('Compare ‘v1.9.0’ with ‘v1.10.0’')
  await dialog.getByTestId('compare-b').click()
  await page.getByTestId('compare-b-search').fill('main')
  await page.getByTestId('ref-select-item').filter({ hasText: /^main$/ }).click()
  await dialog.getByTestId('compare-tab-b').click()
  await expect(dialog.getByTestId('compare-tab-b')).toContainText('(2)')
  await expect(dialog.getByTestId('compare-commits')).toContainText('third')
  await app.close()
})

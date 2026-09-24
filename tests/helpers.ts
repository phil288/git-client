import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll } from 'vitest'

/** Creates a temp dir removed after the test file finishes. Real path (macOS /private, Windows 8.3 names). */
export function tempDir(prefix = 'gitclient-test-'): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Test-side git helper (argument arrays, no shell). Throws on failure. */
export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}`)
  return r.stdout
}

export function write(root: string, rel: string, content: string): void {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
}

/** Initialises a repo with one commit containing README.md. */
export function initRepo(dir: string): string {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q')
  write(dir, 'README.md', '# test\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'initial')
  return dir
}

export function commitFile(dir: string, rel: string, content: string, message: string): void {
  write(dir, rel, content)
  git(dir, 'add', '--', rel)
  git(dir, 'commit', '-q', '-m', message)
}

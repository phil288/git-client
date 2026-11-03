import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AiToolInfo } from '../../src/shared/types'
import { AppError } from '../../src/main/git/errors'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import { resolveConflictsAuto, type ResolveConflictsDeps } from '../../src/main/resolveConflicts'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'
import { fakeAiCli, prompts } from './fakeAiCli'

let runner: GitRunner
const root = tempDir('gitclient-airesolve-')
const bin = join(root, 'bin')
beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
})

function deps(cli: string | null): ResolveConflictsDeps {
  const tools: AiToolInfo[] = cli ? [{ id: 'claude', label: 'Claude Code', path: cli }] : []
  return { runner, settings: () => ({ ...DEFAULT_SETTINGS, aiCommitTool: cli ? 'claude' : 'auto' }), detectTools: () => tools }
}

/** Repo on main with docs/notes.md + src/app.ts; `feat` and main both change both files. */
function setup(name: string): string {
  const repo = initRepo(join(root, name))
  git(repo, 'branch', '-M', 'main')
  commitFile(repo, 'docs/notes.md', '# Notes\n\nintro\n', 'docs: notes')
  commitFile(repo, 'src/app.ts', 'export const a = 1\nexport const b = 1\n', 'feat: app')
  git(repo, 'checkout', '-q', '-b', 'feat')
  commitFile(repo, 'src/app.ts', 'export const a = 3\nexport const b = 1\n', 'feat: a on feat')
  commitFile(repo, 'docs/notes.md', '# Notes\n\nfeat\n', 'docs: feat')
  git(repo, 'checkout', '-q', 'main')
  commitFile(repo, 'src/app.ts', 'export const a = 2\nexport const b = 1\n', 'fix: a on main')
  commitFile(repo, 'docs/notes.md', '# Notes\n\nmain\n', 'docs: main')
  return repo
}

const read = (dir: string, rel: string) => readFileSync(join(dir, rel), 'utf8')
const unmerged = (dir: string) => git(dir, 'diff', '--name-only', '--diff-filter=U').trim()
const tryGit = (dir: string, ...args: string[]) => {
  try {
    git(dir, ...args)
  } catch {
    // conflicts expected
  }
}

describe('resolveConflictsAuto', () => {
  it('resolves an open merge like Auto Merge does and leaves the merge for the user to continue', async () => {
    const repo = setup('merge')
    tryGit(repo, 'merge', 'feat')
    const cli = fakeAiCli(bin, 'merge')
    const res = await resolveConflictsAuto(deps(cli), repo)
    expect(res).toEqual({ unionResolved: ['docs/notes.md'], aiResolved: ['src/app.ts'], regenerated: [], unresolved: [], reasons: [] })
    expect(read(repo, 'src/app.ts')).toBe('export const a = 2\nexport const a = 3\nexport const b = 1\n')
    expect(read(repo, 'docs/notes.md')).toBe('# Notes\n\nmain\nfeat\n')
    expect(unmerged(repo)).toBe('')
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true)
    const asked = prompts(cli)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('<<<<<<< main')
    expect(asked[0]).toContain('>>>>>>> feat')
    expect(asked[0]).toContain('- feat: a on feat')
  })

  it('works during a rebase (labels and intent from the replayed commit)', async () => {
    const repo = setup('rebase')
    git(repo, 'checkout', '-q', 'feat')
    tryGit(repo, 'rebase', 'main')
    const cli = fakeAiCli(bin, 'rebase')
    const res = await resolveConflictsAuto(deps(cli), repo)
    expect(res).toMatchObject({ aiResolved: ['src/app.ts'], unresolved: [] })
    expect(unmerged(repo)).toBe('')
    expect(existsSync(join(repo, '.git', 'rebase-merge'))).toBe(true)
    const asked = prompts(cli)[0]!
    expect(asked).toContain('<<<<<<< main')
    expect(asked).toContain('- feat: a on feat')
  })

  it('handles cherry-pick conflicts and only resolves Markdown when no AI tool is installed', async () => {
    const repo = setup('pick')
    tryGit(repo, 'cherry-pick', 'feat~1', 'feat')
    // First pick: src/app.ts only.
    const noAi = await resolveConflictsAuto(deps(null), repo)
    expect(noAi.unresolved).toEqual(['src/app.ts'])
    expect(noAi.reasons.join('\n')).toMatch(/AI|tool|install/i)
    expect(unmerged(repo)).toBe('src/app.ts')

    const cli = fakeAiCli(bin, 'pick')
    const res = await resolveConflictsAuto(deps(cli), repo)
    expect(res).toMatchObject({ aiResolved: ['src/app.ts'], unresolved: [] })
    expect(existsSync(join(repo, '.git', 'CHERRY_PICK_HEAD'))).toBe(true)
  })

  it('keeps the conflict when the AI answer still has markers', async () => {
    const repo = setup('markers')
    tryGit(repo, 'merge', 'feat')
    const cli = fakeAiCli(bin, 'markers', 'return file')
    const res = await resolveConflictsAuto(deps(cli), repo)
    expect(res.unionResolved).toEqual(['docs/notes.md'])
    expect(res.unresolved).toEqual(['src/app.ts'])
    expect(res.reasons[0]).toContain('left conflict markers')
    expect(unmerged(repo)).toBe('src/app.ts')
  })

  it('stops with CANCELLED when the signal is aborted', async () => {
    const repo = setup('cancel')
    tryGit(repo, 'merge', 'feat')
    const ac = new AbortController()
    ac.abort()
    await expect(resolveConflictsAuto(deps(fakeAiCli(bin, 'cancel')), repo, { signal: ac.signal })).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'CANCELLED')
  })

  describe('lockfiles', () => {
    /** Repo where main and feat both change Cargo.lock, and optionally Cargo.toml too. */
    function lockSetup(name: string, manifestConflict = false): string {
      const repo = initRepo(join(root, name))
      git(repo, 'branch', '-M', 'main')
      commitFile(repo, 'Cargo.toml', 'version = 1\n', 'manifest')
      commitFile(repo, 'Cargo.lock', 'lock base\n', 'lock')
      git(repo, 'checkout', '-q', '-b', 'feat')
      if (manifestConflict) commitFile(repo, 'Cargo.toml', 'version = 3\n', 'manifest on feat')
      commitFile(repo, 'Cargo.lock', 'lock feat\n', 'lock on feat')
      git(repo, 'checkout', '-q', 'main')
      if (manifestConflict) commitFile(repo, 'Cargo.toml', 'version = 2\n', 'manifest on main')
      commitFile(repo, 'Cargo.lock', 'lock main\n', 'lock on main')
      tryGit(repo, 'merge', 'feat')
      return repo
    }

    /** Fake cargo: records the lockfile it starts from and the manifest it sees into the lockfile. */
    function fakeCargo(name: string, body = "writeFileSync('Cargo.lock', 'from ' + readFileSync('Cargo.lock', 'utf8') + readFileSync('Cargo.toml', 'utf8'))"): () => string {
      write(bin, `${name}.mjs`, `import { readFileSync, writeFileSync } from 'node:fs'\n${body}\n`)
      return () => join(bin, `${name}.mjs`)
    }

    it('regenerates from the Yours side without the AI, and leaves no conflict', async () => {
      const repo = lockSetup('lock-ok')
      const cli = fakeAiCli(bin, 'lock-ok')
      const res = await resolveConflictsAuto({ ...deps(cli), findLockfileBinary: fakeCargo('cargo-ok') }, repo)
      expect(res).toEqual({ unionResolved: [], aiResolved: [], regenerated: ['Cargo.lock'], unresolved: [], reasons: [] })
      expect(read(repo, 'Cargo.lock')).toBe('from lock main\nversion = 1\n')
      expect(unmerged(repo)).toBe('')
      expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true)
      expect(prompts(cli)).toHaveLength(0)
    })

    it('runs after the AI resolved the manifest', async () => {
      const repo = lockSetup('lock-order', true)
      const res = await resolveConflictsAuto({ ...deps(fakeAiCli(bin, 'lock-order')), findLockfileBinary: fakeCargo('cargo-order') }, repo)
      expect(res).toMatchObject({ aiResolved: ['Cargo.toml'], regenerated: ['Cargo.lock'], unresolved: [] })
      expect(read(repo, 'Cargo.lock')).toBe('from lock main\nversion = 2\nversion = 3\n')
    })

    it('waits for the other conflicts when one is left, without running the tool', async () => {
      const repo = lockSetup('lock-blocked', true)
      const res = await resolveConflictsAuto({ ...deps(null), findLockfileBinary: fakeCargo('cargo-blocked', "writeFileSync('Cargo.lock', 'ran')") }, repo)
      expect(res.regenerated).toEqual([])
      expect(res.unresolved).toEqual(['Cargo.toml', 'Cargo.lock'])
      expect(res.reasons.join('\n')).toContain('Cargo.lock: regenerated once the other conflicts are resolved')
      expect(read(repo, 'Cargo.lock')).toContain('<<<<<<<')
    })

    it('keeps the conflict when the package manager is missing or fails', async () => {
      const repo = lockSetup('lock-fail')
      const missing = await resolveConflictsAuto({ ...deps(null), findLockfileBinary: () => null }, repo)
      expect(missing.unresolved).toEqual(['Cargo.lock'])
      expect(missing.reasons[0]).toContain('cargo was not found')
      expect(read(repo, 'Cargo.lock')).toContain('<<<<<<<')

      const failed = await resolveConflictsAuto({ ...deps(null), findLockfileBinary: fakeCargo('cargo-fail', "writeFileSync('Cargo.lock', 'half'); console.error('no registry'); process.exit(3)") }, repo)
      expect(failed.unresolved).toEqual(['Cargo.lock'])
      expect(failed.reasons[0]).toContain('no registry')
      expect(unmerged(repo)).toBe('Cargo.lock')
      expect(read(repo, 'Cargo.lock')).toContain('<<<<<<<')
      expect(read(repo, 'Cargo.lock')).toContain('lock feat')
    })

    it('restores the conflict when cancelled while the tool runs', async () => {
      const repo = lockSetup('lock-cancel')
      const ac = new AbortController()
      const run = resolveConflictsAuto({ ...deps(null), findLockfileBinary: fakeCargo('cargo-hang', 'setTimeout(() => undefined, 60000)') }, repo, { signal: ac.signal })
      setTimeout(() => ac.abort(), 300)
      await expect(run).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'CANCELLED')
      expect(unmerged(repo)).toBe('Cargo.lock')
      expect(read(repo, 'Cargo.lock')).toContain('<<<<<<<')
    })

    it('keeps the replayed commit out of the base during a rebase (Yours is the upstream)', async () => {
      const repo = initRepo(join(root, 'lock-rebase'))
      git(repo, 'branch', '-M', 'main')
      commitFile(repo, 'Cargo.toml', 'version = 1\n', 'manifest')
      commitFile(repo, 'Cargo.lock', 'lock base\n', 'lock')
      git(repo, 'checkout', '-q', '-b', 'feat')
      commitFile(repo, 'Cargo.lock', 'lock feat\n', 'lock on feat')
      git(repo, 'checkout', '-q', 'main')
      commitFile(repo, 'Cargo.lock', 'lock main\n', 'lock on main')
      git(repo, 'checkout', '-q', 'feat')
      tryGit(repo, 'rebase', 'main')
      const res = await resolveConflictsAuto({ ...deps(null), findLockfileBinary: fakeCargo('cargo-rebase') }, repo)
      expect(res).toMatchObject({ regenerated: ['Cargo.lock'], unresolved: [] })
      expect(read(repo, 'Cargo.lock')).toBe('from lock main\nversion = 1\n')
    })

    it('regenerates package-lock.json with the real npm', async () => {
      const repo = initRepo(join(root, 'lock-npm'))
      git(repo, 'branch', '-M', 'main')
      const lock = (mark: string) => JSON.stringify({ name: 'x', version: '1.0.0', mark, lockfileVersion: 3, requires: true, packages: { '': { name: 'x', version: '1.0.0' } } }, null, 2) + '\n'
      commitFile(repo, 'web/package.json', '{\n  "name": "x",\n  "version": "1.0.0"\n}\n', 'manifest')
      commitFile(repo, 'web/package-lock.json', lock('base'), 'lock')
      git(repo, 'checkout', '-q', '-b', 'feat')
      commitFile(repo, 'web/package-lock.json', lock('feat'), 'lock on feat')
      git(repo, 'checkout', '-q', 'main')
      commitFile(repo, 'web/package-lock.json', lock('main'), 'lock on main')
      tryGit(repo, 'merge', 'feat')
      const res = await resolveConflictsAuto(deps(null), repo)
      expect(res).toMatchObject({ regenerated: ['web/package-lock.json'], unresolved: [] })
      expect(unmerged(repo)).toBe('')
      expect(JSON.parse(read(repo, 'web/package-lock.json'))).toMatchObject({ name: 'x', lockfileVersion: 3 })
      expect(existsSync(join(repo, 'web', 'node_modules'))).toBe(false)
    }, 60_000)
  })
})

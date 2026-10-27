import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AiToolInfo } from '../../src/shared/types'
import { AppError } from '../../src/main/git/errors'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import { resolveConflictsAuto, type ResolveConflictsDeps } from '../../src/main/resolveConflicts'
import { commitFile, git, initRepo, tempDir } from '../helpers'
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
    expect(res).toEqual({ unionResolved: ['docs/notes.md'], aiResolved: ['src/app.ts'], unresolved: [], reasons: [] })
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
})

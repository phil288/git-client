import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AiToolInfo } from '../../src/shared/types'
import { autoRebase } from '../../src/main/autoRebase'
import { AppError } from '../../src/main/git/errors'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import type { ResolveConflictsDeps } from '../../src/main/resolveConflicts'
import { commitFile, git, initRepo, tempDir } from '../helpers'
import { fakeAiCli, prompts } from './fakeAiCli'

let runner: GitRunner
const root = tempDir('gitclient-autorebase-')
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

/** main and feat both change src/app.ts and docs/notes.md; feat has one commit per file, so the rebase stops twice. */
function setup(name: string): string {
  const repo = initRepo(join(root, name))
  git(repo, 'branch', '-M', 'main')
  commitFile(repo, 'docs/notes.md', '# Notes\n\nintro\n', 'docs: notes')
  commitFile(repo, 'src/app.ts', 'export const a = 1\nexport const b = 1\n', 'feat: app')
  git(repo, 'checkout', '-q', '-b', 'feat')
  commitFile(repo, 'src/app.ts', 'export const a = 3\nexport const b = 1\n', 'feat: a on feat')
  commitFile(repo, 'docs/notes.md', '# Notes\n\nfeat\n', 'docs: feat')
  commitFile(repo, 'src/other.ts', 'export const c = 1\n', 'feat: other')
  git(repo, 'checkout', '-q', 'main')
  commitFile(repo, 'src/app.ts', 'export const a = 2\nexport const b = 1\n', 'fix: a on main')
  commitFile(repo, 'docs/notes.md', '# Notes\n\nmain\n', 'docs: main')
  git(repo, 'checkout', '-q', 'feat')
  return repo
}

const read = (dir: string, rel: string) => readFileSync(join(dir, rel), 'utf8')
const rebasing = (dir: string) => existsSync(join(dir, '.git', 'rebase-merge')) || existsSync(join(dir, '.git', 'rebase-apply'))
const subjects = (dir: string) => git(dir, 'log', '--format=%s', 'main..feat').trim().split('\n')
const tryGit = (dir: string, ...args: string[]) => {
  try {
    git(dir, ...args)
  } catch {
    // conflicts expected
  }
}
const OURS_ONLY = `const out = []; let mode = null
  for (const l of file.split('\\n')) {
    if (l.startsWith('<<<<<<< ')) mode = 'ours'
    else if (l.startsWith('||||||| ')) mode = 'base'
    else if (l === '=======') mode = 'theirs'
    else if (l.startsWith('>>>>>>> ')) mode = null
    else if (mode === null || mode === 'ours') out.push(l)
  }
  return out.join('\\n')`

describe('autoRebase', () => {
  it('rebases through every conflicting step: Markdown keeps both sides, code goes to the AI', async () => {
    const repo = setup('happy')
    const cli = fakeAiCli(bin, 'happy')
    const res = await autoRebase(deps(cli), repo, 'main', null)
    expect(res).toMatchObject({ status: 'done', started: true, resolvedSteps: 2, unionResolved: ['docs/notes.md'], aiResolved: ['src/app.ts'], unresolved: [] })
    expect(rebasing(repo)).toBe(false)
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('feat')
    expect(git(repo, 'merge-base', '--is-ancestor', 'main', 'feat')).toBe('')
    expect(subjects(repo)).toEqual(['feat: other', 'docs: feat', 'feat: a on feat'])
    expect(read(repo, 'src/app.ts')).toBe('export const a = 2\nexport const a = 3\nexport const b = 1\n')
    expect(read(repo, 'docs/notes.md')).toBe('# Notes\n\nmain\nfeat\n')
    expect(git(repo, 'for-each-ref', '--format=%(refname)', 'refs/gitclient-backup/').trim()).toMatch(/feat\/\d+-rebase$/)
    expect(prompts(cli)).toHaveLength(1)
  })

  it('rebases another branch (checkout and rebase) and reports a clean rebase as done', async () => {
    const repo = initRepo(join(root, 'clean'))
    git(repo, 'branch', '-M', 'main')
    git(repo, 'checkout', '-q', '-b', 'side')
    commitFile(repo, 'b.txt', 'b\n', 'side: b')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'a.txt', 'a\n', 'main: a')
    const res = await autoRebase(deps(null), repo, 'main', 'side')
    expect(res).toMatchObject({ status: 'done', started: true, resolvedSteps: 0, aiResolved: [], unionResolved: [] })
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('side')
    expect(git(repo, 'merge-base', '--is-ancestor', 'main', 'side')).toBe('')
  })

  it('resumes a rebase already stopped on conflicts', async () => {
    const repo = setup('resume')
    tryGit(repo, 'rebase', 'main')
    expect(rebasing(repo)).toBe(true)
    const res = await autoRebase(deps(fakeAiCli(bin, 'resume')), repo, null, null)
    expect(res).toMatchObject({ status: 'done', started: false, resolvedSteps: 2 })
    expect(res.message).toContain('feat')
    expect(rebasing(repo)).toBe(false)
  })

  it('stops with the rebase open when a step cannot be resolved, keeping earlier steps', async () => {
    const repo = setup('markers')
    const res = await autoRebase(deps(fakeAiCli(bin, 'markers', 'return file')), repo, 'main', null)
    expect(res).toMatchObject({ status: 'stopped', resolvedSteps: 0, unresolved: ['src/app.ts'] })
    expect(res.reasons[0]).toContain('left conflict markers')
    expect(res.message).toMatch(/Step 1\/3/)
    expect(rebasing(repo)).toBe(true)
    expect(git(repo, 'diff', '--name-only', '--diff-filter=U').trim()).toBe('src/app.ts')
  })

  it('drops a commit whose resolution leaves nothing to commit', async () => {
    const repo = setup('empty')
    const res = await autoRebase(deps(fakeAiCli(bin, 'empty', OURS_ONLY)), repo, 'main', null)
    expect(res.status).toBe('done')
    expect(rebasing(repo)).toBe(false)
    expect(subjects(repo)).toEqual(['feat: other', 'docs: feat'])
    expect(read(repo, 'src/app.ts')).toBe('export const a = 2\nexport const b = 1\n')
  })

  it('refuses to start over another operation and to resume without a rebase', async () => {
    const repo = setup('refuse')
    const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code
    await expect(autoRebase(deps(null), repo, null, null)).rejects.toSatisfy(isCode('INVALID_ARGUMENT'))
    tryGit(repo, 'rebase', 'main')
    await expect(autoRebase(deps(null), repo, 'main', null)).rejects.toSatisfy(isCode('DIRTY'))
  })

  it('stops with CANCELLED and leaves the rebase open', async () => {
    const repo = setup('cancel')
    tryGit(repo, 'rebase', 'main')
    const ac = new AbortController()
    ac.abort()
    await expect(autoRebase(deps(fakeAiCli(bin, 'cancel')), repo, null, null, { signal: ac.signal })).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === 'CANCELLED'
    )
    expect(rebasing(repo)).toBe(true)
  })
})

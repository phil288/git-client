import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AiToolInfo, type Settings } from '../../src/shared/types'
import { autoMergeWorktree, type AutoMergeDeps } from '../../src/main/autoMerge'
import { AppError } from '../../src/main/git/errors'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let runner: GitRunner
const root = tempDir('gitclient-automerge-')
const bin = join(root, 'bin')
beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
})

/**
 * Fake CLI (same seam as tests/integration/ai.test.ts): commit-message prompts get
 * `commitMessage`; conflict prompts get `resolve(markedFile)`'s output. Every
 * prompt is appended to <cli>.log so tests can see what was asked.
 */
function fakeCli(name: string, resolveBody = 'return keepBoth(file)', commitMessage = 'feat: work from the worktree'): string {
  const p = join(bin, `${name}.mjs`)
  write(bin, `${name}.mjs`, '')
  writeFileSync(
    p,
    `import { appendFileSync } from 'node:fs'
function keepBoth(file) {
  const out = []
  let mode = null
  for (const l of file.split('\\n')) {
    if (l.startsWith('<<<<<<< ')) mode = 'ours'
    else if (l.startsWith('||||||| ')) mode = 'base'
    else if (l === '=======') mode = 'theirs'
    else if (l.startsWith('>>>>>>> ')) mode = null
    else if (mode !== 'base') out.push(l)
  }
  return out.join('\\n')
}
function resolve(file) { ${resolveBody} }
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', async () => {
  const prompt = Buffer.concat(chunks).toString('utf8')
  appendFileSync(${JSON.stringify(p + '.log')}, prompt + '\\n<<END PROMPT>>\\n')
  const m = /--- BEGIN FILE ---\\n([\\s\\S]*)\\n--- END FILE ---/.exec(prompt)
  if (m) process.stdout.write(await resolve(m[1]))
  else process.stdout.write(${JSON.stringify(commitMessage)} + '\\n')
})
`
  )
  return p
}

function deps(cli: string, patch: Partial<Settings> = {}): AutoMergeDeps {
  const tools: AiToolInfo[] = [{ id: 'claude', label: 'Claude Code', path: cli }]
  return { runner, settings: () => ({ ...DEFAULT_SETTINGS, aiCommitTool: 'claude', ...patch }), detectTools: () => tools }
}

/** main repo (on main) with docs/notes.md + src/app.ts, and a linked worktree on `feat`. */
function setup(name: string): { main: string; wt: string } {
  const main = initRepo(join(root, name))
  git(main, 'branch', '-M', 'main')
  commitFile(main, 'docs/notes.md', '# Notes\n\nintro\n', 'docs: notes')
  commitFile(main, 'src/app.ts', 'export const a = 1\nexport const b = 1\n', 'feat: app')
  const wt = join(root, `${name}-wt`)
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt, 'main')
  return { main, wt }
}

const read = (dir: string, rel: string) => readFileSync(join(dir, rel), 'utf8')
const branchExists = (dir: string, b: string) => git(dir, 'branch', '--list', b).trim() !== ''
const mergeHead = (dir: string) => existsSync(join(dir, '.git', 'MERGE_HEAD'))
const prompts = (cli: string) => (existsSync(`${cli}.log`) ? readFileSync(`${cli}.log`, 'utf8').split('\n<<END PROMPT>>\n').filter(Boolean) : [])

describe('autoMergeWorktree', () => {
  it('commits uncommitted work with an AI message, merges, removes the worktree and deletes the branch', async () => {
    const { main, wt } = setup('happy')
    write(wt, 'src/new.ts', 'export const n = 1\n')
    const cli = fakeCli('happy')
    const steps: number[] = []
    const res = await autoMergeWorktree(deps(cli), main, wt, { progress: (n) => steps.push(n) })
    expect(res).toMatchObject({ status: 'done', target: 'main', merged: 1, worktreeRemoved: true, branchDeleted: true, aiResolved: [], unionResolved: [] })
    expect(res.status === 'done' && res.committed).toBeTruthy()
    expect(read(main, 'src/new.ts')).toBe('export const n = 1\n')
    expect(git(main, 'log', '-1', '--format=%s', 'main').trim()).toBe('feat: work from the worktree')
    expect(existsSync(wt)).toBe(false)
    expect(branchExists(main, 'feat')).toBe(false)
    expect(steps).toContain(1)
    expect(steps).toContain(6)
  })

  it('blocks before merging when main is not clean, then resumes once it is', async () => {
    const { main, wt } = setup('dirty')
    commitFile(wt, 'f.txt', 'feature\n', 'feature work')
    write(main, 'scratch.txt', 'wip\n')
    const cli = fakeCli('dirty')
    const res = await autoMergeWorktree(deps(cli), main, wt)
    expect(res).toMatchObject({ status: 'blocked', target: 'main', host: main, dirty: ['scratch.txt'] })
    expect(mergeHead(main)).toBe(false)
    expect(existsSync(join(main, 'f.txt'))).toBe(false)
    expect(existsSync(wt)).toBe(true)

    git(main, 'clean', '-fdq')
    const again = await autoMergeWorktree(deps(cli), main, wt)
    expect(again).toMatchObject({ status: 'done', merged: 1, worktreeRemoved: true })
    expect(read(main, 'f.txt')).toBe('feature\n')
  })

  it('resolves Markdown-only conflicts by keeping both sides, without asking the AI', async () => {
    const { main, wt } = setup('md')
    commitFile(main, 'docs/notes.md', '# Notes\n\nintro from main\n', 'docs: main')
    commitFile(wt, 'docs/notes.md', '# Notes\n\nintro from feat\n', 'docs: feat')
    const cli = fakeCli('md')
    const res = await autoMergeWorktree(deps(cli), main, wt)
    expect(res).toMatchObject({ status: 'done', unionResolved: ['docs/notes.md'], aiResolved: [], worktreeRemoved: true })
    expect(read(main, 'docs/notes.md')).toBe('# Notes\n\nintro from main\nintro from feat\n')
    expect(git(main, 'log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2)
    expect(prompts(cli)).toHaveLength(0)
  })

  it('sends code conflicts to the AI (Markdown still kept both) and commits the merge', async () => {
    const { main, wt } = setup('code')
    commitFile(main, 'src/app.ts', 'export const a = 2\nexport const b = 1\n', 'fix: a on main')
    commitFile(main, 'docs/notes.md', '# Notes\n\nmain\n', 'docs: main')
    commitFile(wt, 'src/app.ts', 'export const a = 3\nexport const b = 1\n', 'feat: a on feat')
    commitFile(wt, 'docs/notes.md', '# Notes\n\nfeat\n', 'docs: feat')
    const cli = fakeCli('code')
    const res = await autoMergeWorktree(deps(cli), main, wt)
    expect(res).toMatchObject({ status: 'done', unionResolved: ['docs/notes.md'], aiResolved: ['src/app.ts'], branchDeleted: true })
    expect(read(main, 'src/app.ts')).toBe('export const a = 2\nexport const a = 3\nexport const b = 1\n')
    expect(read(main, 'docs/notes.md')).toBe('# Notes\n\nmain\nfeat\n')
    const asked = prompts(cli)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('File: src/app.ts')
    expect(asked[0]).toContain('<<<<<<< main')
    expect(asked[0]).toContain('>>>>>>> feat')
    expect(asked[0]).toContain('- fix: a on main')
    expect(asked[0]).toContain('- feat: a on feat')
    expect(mergeHead(main)).toBe(false)
  })

  it('uses the conflict-resolution tool from Settings', async () => {
    const { main, wt } = setup('tool')
    commitFile(main, 'src/app.ts', 'export const a = 2\nexport const b = 1\n', 'main')
    commitFile(wt, 'src/app.ts', 'export const a = 3\nexport const b = 1\n', 'feat')
    const commitCli = fakeCli('tool-commit')
    const mergeCli = fakeCli('tool-merge')
    const d = deps(commitCli, { aiMergeTool: 'codex' })
    d.detectTools = () => [
      { id: 'claude', label: 'Claude Code', path: commitCli },
      { id: 'codex', label: 'OpenAI Codex', path: mergeCli }
    ]
    // Codex answers through `-o <file>`; the fake prints to stdout, which runTool also accepts.
    const res = await autoMergeWorktree(d, main, wt)
    expect(res.status).toBe('done')
    expect(prompts(commitCli)).toHaveLength(0)
    expect(prompts(mergeCli)).toHaveLength(1)
  })

  it('stops with the merge open when the AI leaves markers, and finishes on a re-run after manual resolution', async () => {
    const { main, wt } = setup('stop')
    commitFile(main, 'src/app.ts', 'export const a = 2\nexport const b = 1\n', 'main')
    commitFile(wt, 'src/app.ts', 'export const a = 3\nexport const b = 1\n', 'feat')
    const cli = fakeCli('stop', 'return file')
    const res = await autoMergeWorktree(deps(cli), main, wt)
    expect(res).toMatchObject({ status: 'stopped', host: main, unresolved: ['src/app.ts'] })
    expect(res.status === 'stopped' && res.message).toMatch(/left conflict markers in src\/app\.ts/)
    expect(mergeHead(main)).toBe(true)
    expect(existsSync(wt)).toBe(true)

    // The user resolves by hand (conflict tool), then clicks Auto Merge again.
    write(main, 'src/app.ts', 'export const a = 4\nexport const b = 1\n')
    git(main, 'add', 'src/app.ts')
    const again = await autoMergeWorktree(deps(fakeCli('stop-2')), main, wt)
    expect(again).toMatchObject({ status: 'done', worktreeRemoved: true, branchDeleted: true })
    expect(mergeHead(main)).toBe(false)
    expect(read(main, 'src/app.ts')).toBe('export const a = 4\nexport const b = 1\n')
  })

  it('cleans up only when the branch was already merged by hand', async () => {
    const { main, wt } = setup('done-by-hand')
    commitFile(wt, 'f.txt', 'feature\n', 'feature work')
    git(main, 'merge', '-q', '--no-ff', '--no-edit', 'feat')
    const res = await autoMergeWorktree(deps(fakeCli('by-hand')), main, wt)
    expect(res).toMatchObject({ status: 'done', merged: 0, worktreeRemoved: true, branchDeleted: true })
  })

  it('cancelling during the AI call keeps the merge open', async () => {
    const { main, wt } = setup('cancel')
    commitFile(main, 'src/app.ts', 'export const a = 2\nexport const b = 1\n', 'main')
    commitFile(wt, 'src/app.ts', 'export const a = 3\nexport const b = 1\n', 'feat')
    const cli = fakeCli('cancel', 'return new Promise(() => setTimeout(() => {}, 60_000))')
    const ac = new AbortController()
    const p = autoMergeWorktree(deps(cli), main, wt, {
      signal: ac.signal,
      progress: (n, m) => {
        if (n === 4 && m.startsWith('Resolving src/app.ts')) setTimeout(() => ac.abort(), 200)
      }
    })
    const err = await p.then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('CANCELLED')
    expect(mergeHead(main)).toBe(true)
    expect(existsSync(wt)).toBe(true)
  }, 20_000)

  it('refuses the main worktree and locked worktrees before changing anything', async () => {
    const { main, wt } = setup('refuse')
    const cli = fakeCli('refuse')
    await expect(autoMergeWorktree(deps(cli), main, main)).rejects.toThrow(/linked worktrees/)
    git(main, 'worktree', 'lock', wt)
    write(wt, 'x.txt', 'x\n')
    await expect(autoMergeWorktree(deps(cli), main, wt)).rejects.toMatchObject({ code: 'LOCKED' })
    expect(git(wt, 'status', '--porcelain')).toContain('x.txt')
  })
})

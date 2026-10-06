import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { generateCommitMessage } from '../../src/main/ai/commitMessage'
import { detectTools } from '../../src/main/ai/detect'
import { AppError } from '../../src/main/git/errors'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let runner: GitRunner
// Not 'gitclient-ai-': that prefix is runTool's own temp dir, asserted to be cleaned up below.
const root = tempDir('gitclient-aitest-')
const aiTempDirs = () => new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('gitclient-ai-')))
const newTempDirs = (before: Set<string>) => [...aiTempDirs()].filter((n) => !before.has(n))
const bin = join(root, 'bin')
beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
})

/**
 * Writes a fake CLI (an .mjs run through our own runtime, the same seam e2e uses via
 * GITCLIENT_AI_<TOOL>_PATH). It saves stdin + argv next to itself, then runs `body`.
 */
function fakeCli(name: string, body: string): string {
  const p = join(bin, `${name}.mjs`)
  write(bin, `${name}.mjs`, '')
  writeFileSync(
    p,
    `import { writeFileSync } from 'node:fs'
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', async () => {
  writeFileSync(${JSON.stringify(p + '.stdin')}, Buffer.concat(chunks))
  writeFileSync(${JSON.stringify(p + '.argv')}, JSON.stringify(process.argv.slice(2)))
  ${body}
})
`
  )
  return p
}

const captured = (p: string) => readFileSync(`${p}.stdin`, 'utf8')

function repoWithStagedChange(name: string): string {
  const r = initRepo(join(root, name))
  commitFile(r, 'src/app.ts', 'export const a = 1\n', 'feat: add app')
  commitFile(r, 'docs/notes.md', 'notes\n', 'docs: notes')
  write(r, 'src/app.ts', 'export const a = 2\nexport const unique_marker_xyz = true\n')
  write(r, 'src/new file.ts', 'export {}\n')
  git(r, 'add', '-A')
  return r
}

async function expectAppError(p: Promise<unknown>, code: string, message: RegExp): Promise<AppError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(AppError)
  expect((err as AppError).code).toBe(code)
  expect((err as AppError).message).toMatch(message)
  return err as AppError
}

describe('generateCommitMessage with a fake CLI', () => {
  it('feeds the staged diff on stdin and returns the cleaned answer', async () => {
    const r = repoWithStagedChange('ok')
    const cli = fakeCli('claude-ok', "process.stdout.write('```\\r\\nfeat(app): bump a\\r\\n\\r\\nCo-Authored-By: Bot <b@x>\\r\\n```\\r\\n')")
    const steps: string[] = []
    const res = await generateCommitMessage(runner, r, { id: 'claude', path: cli }, { amend: false, recentMessages: ['fix: from the app'], onProgress: (m) => steps.push(m) })
    expect(res).toEqual({ message: 'feat(app): bump a', tool: 'claude' })
    expect(steps).toEqual(['Reading staged changes…', 'Asking Claude Code…'])

    const prompt = captured(cli)
    expect(prompt).toContain('unique_marker_xyz')
    expect(prompt).toContain('src/app.ts')
    expect(prompt).toContain('src/new file.ts')
    expect(prompt).toContain('Conventional Commits')
    expect(prompt).toContain('- fix: from the app')
    // Fixed flags only; the prompt never reaches argv.
    const argv = JSON.parse(readFileSync(`${cli}.argv`, 'utf8')) as string[]
    expect(argv).toEqual(['-p', '--output-format', 'text', '--tools', '', '--no-session-persistence', '--disable-slash-commands'])
  })

  it('reads the answer file for codex (-o) and ignores stdout noise', async () => {
    const r = repoWithStagedChange('codex')
    const cli = fakeCli(
      'codex',
      `const argv = process.argv.slice(2)
  writeFileSync(argv[argv.indexOf('-o') + 1], 'Bump a and add new file\\n')
  process.stdout.write('thinking... tokens used: 1234\\n')`
    )
    const before = aiTempDirs()
    const res = await generateCommitMessage(runner, r, { id: 'codex', path: cli }, { amend: false })
    expect(res.message).toBe('Bump a and add new file')
    expect(newTempDirs(before)).toEqual([])
  })

  it('removes the answer temp dir when the CLI cannot be spawned', async () => {
    const r = repoWithStagedChange('spawn-error')
    const before = aiTempDirs()
    await expectAppError(generateCommitMessage(runner, r, { id: 'codex', path: join(bin, 'no-such-codex') }, { amend: false }), 'UNKNOWN', /not found/)
    expect(newTempDirs(before)).toEqual([])
  })

  it('amend describes HEAD~1..index and includes the current message', async () => {
    const r = initRepo(join(root, 'amend'))
    commitFile(r, 'one.txt', 'one\n', 'Add one')
    commitFile(r, 'two.txt', 'two_marker\n', 'Add two')
    const cli = fakeCli('claude-amend', "process.stdout.write('Add two\\n')")
    await generateCommitMessage(runner, r, { id: 'claude', path: cli }, { amend: true })
    const prompt = captured(cli)
    expect(prompt).toContain('two_marker')
    expect(prompt).not.toContain('one.txt')
    expect(prompt).toContain('being amended')

    // Root commit: diff against the empty tree.
    const solo = initRepo(join(root, 'amend-root'))
    await generateCommitMessage(runner, solo, { id: 'claude', path: cli }, { amend: true })
    expect(captured(cli)).toContain('README.md')
  })

  it('fails clearly when nothing is staged', async () => {
    const r = initRepo(join(root, 'nothing'))
    write(r, 'README.md', 'changed but not staged\n')
    const cli = fakeCli('claude-unused', "process.stdout.write('x')")
    await expectAppError(generateCommitMessage(runner, r, { id: 'claude', path: cli }, { amend: false }), 'INVALID_ARGUMENT', /Nothing is staged/)
    expect(existsSync(`${cli}.stdin`)).toBe(false)
  })

  it('reports a failing CLI with its stderr and a login hint', async () => {
    const r = repoWithStagedChange('fail')
    const cli = fakeCli('claude-fail', "process.stderr.write('noise\\nError: not authenticated\\n'); process.exit(3)")
    const err = await expectAppError(generateCommitMessage(runner, r, { id: 'claude', path: cli }, { amend: false }), 'UNKNOWN', /exit code 3/)
    expect(err.message).toContain('Error: not authenticated')
    expect(err.message).toContain('logged in')
    expect(err.extra.exitCode).toBe(3)
  })

  it('treats empty output as an error', async () => {
    const r = repoWithStagedChange('empty')
    const cli = fakeCli('claude-empty', "process.stdout.write('  \\n\\n')")
    await expectAppError(generateCommitMessage(runner, r, { id: 'claude', path: cli }, { amend: false }), 'UNKNOWN', /empty message/)
  })

  it('abort kills the hanging CLI (and its children) promptly', async () => {
    const r = repoWithStagedChange('hang')
    const pidFile = join(bin, 'hang.pids')
    const cli = fakeCli(
      'claude-hang',
      `const { spawn } = await import('node:child_process')
  const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, kid.pid]))
  setInterval(() => {}, 1000)`
    )
    const ac = new AbortController()
    const before = aiTempDirs()
    const started = Date.now()
    // codex: the tool that gets an answer temp dir, which must be removed on abort too.
    const p = generateCommitMessage(runner, r, { id: 'codex', path: cli }, { amend: false, signal: ac.signal })
    while (!existsSync(pidFile)) await new Promise((res) => setTimeout(res, 25))
    expect(newTempDirs(before)).toHaveLength(1)
    ac.abort()
    await expectAppError(p, 'CANCELLED', /cancelled/)
    expect(newTempDirs(before)).toEqual([])
    expect(Date.now() - started).toBeLessThan(5000)

    const pids = JSON.parse(readFileSync(pidFile, 'utf8')) as number[]
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    const deadline = Date.now() + 3000
    while (pids.some(alive) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 50))
    expect(pids.filter(alive)).toEqual([])
  })

  it('times out', async () => {
    const r = repoWithStagedChange('timeout')
    const cli = fakeCli('claude-slow', 'setInterval(() => {}, 1000)')
    await expectAppError(generateCommitMessage(runner, r, { id: 'claude', path: cli }, { amend: false, timeoutMs: 500 }), 'UNKNOWN', /did not answer within/)
  })
})

describe('detectTools seam', () => {
  it('uses GITCLIENT_AI_<TOOL>_PATH and can ignore PATH', () => {
    const cli = fakeCli('fake-gemini', '')
    const tools = detectTools(process.platform, { GITCLIENT_AI_GEMINI_PATH: cli, GITCLIENT_AI_NO_PATH_SEARCH: '1' })
    expect(tools.map((t) => [t.id, t.path])).toEqual([
      ['claude', null],
      ['codex', null],
      ['copilot', null],
      ['cursor', null],
      ['gemini', cli]
    ])
    expect(detectTools(process.platform, { GITCLIENT_AI_GEMINI_PATH: join(bin, 'missing.mjs'), GITCLIENT_AI_NO_PATH_SEARCH: '1' })[4]?.path).toBeNull()
  })
})

import { win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanCommitMessage } from '../../src/main/ai/clean'
import { detectTools, resolveBinary } from '../../src/main/ai/detect'
import { buildPrompt, splitDiff, truncateDiff, usesConventionalCommits } from '../../src/main/ai/prompt'
import { AI_TOOL_SPECS, buildInvocation } from '../../src/main/ai/tools'

const fileDiff = (name: string, lines: number): string =>
  `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1,${lines} @@\n` +
  Array.from({ length: lines }, (_, i) => `+line ${i} of ${name}`).join('\n') +
  '\n'

describe('conventional commit detection', () => {
  it('needs at least half of the subjects', () => {
    expect(usesConventionalCommits(['feat: a', 'fix(ui): b', 'Update readme', 'Merge x'])).toBe(true)
    expect(usesConventionalCommits(['feat!: a', 'Update readme', 'Merge x'])).toBe(false)
    expect(usesConventionalCommits(['refactor(core)!: x'])).toBe(true)
    expect(usesConventionalCommits(['Add thing', 'Fix thing'])).toBe(false)
    expect(usesConventionalCommits([])).toBe(false)
    expect(usesConventionalCommits(['feature: nope', 'fixes: nope'])).toBe(false)
  })
})

describe('diff truncation', () => {
  it('keeps small diffs untouched', () => {
    const d = fileDiff('a.ts', 5)
    expect(truncateDiff(d, 10_000)).toBe(d)
    expect(splitDiff(d + fileDiff('b.ts', 2))).toHaveLength(2)
  })

  it('cuts the longest files first and keeps small files whole', () => {
    const small = fileDiff('small.ts', 3)
    const big = fileDiff('big.ts', 5000)
    const medium = fileDiff('medium.ts', 50)
    const budget = 8000
    const out = truncateDiff(small + big + medium, budget)
    expect(out).toContain(small)
    expect(out).toContain(medium)
    expect(out).toContain('diff --git a/big.ts b/big.ts')
    expect(out).toMatch(/\[truncated: \d+ more lines\]/)
    // Budget respected, give or take the truncation markers.
    expect(out.length).toBeLessThan(budget + 200)
  })

  it('shares the budget fairly between several huge files', () => {
    const out = truncateDiff(fileDiff('x.ts', 4000) + fileDiff('y.ts', 4000), 10_000)
    const [x, y] = splitDiff(out)
    expect(x).toContain('[truncated')
    expect(y).toContain('[truncated')
    expect(Math.abs((x?.length ?? 0) - (y?.length ?? 0))).toBeLessThan(200)
  })
})

describe('prompt', () => {
  const base = { diff: fileDiff('src/app.ts', 3), stat: ' src/app.ts | 3 +++\n', recentSubjects: [] as string[], amend: false }

  it('contains rules, stat and diff', () => {
    const p = buildPrompt(base)
    expect(p).toContain('Output ONLY the raw commit message')
    expect(p).toContain('src/app.ts | 3 +++')
    expect(p).toContain('+line 0 of src/app.ts')
    expect(p).toContain('imperative mood')
    expect(p).not.toContain('Conventional Commits')
  })

  it('asks for conventional commits only when history uses them', () => {
    const p = buildPrompt({ ...base, recentSubjects: ['feat: x', 'fix: y', 'docs: z'] })
    expect(p).toContain('Conventional Commits')
    expect(p).toContain('- feat: x')
  })

  it('merges app-recent messages as style hints without duplicates', () => {
    const p = buildPrompt({ ...base, recentSubjects: ['Add a'], recentMessages: ['Add a', 'Fix b\n\nzzbodyzz'] })
    expect(p.match(/- Add a/g)).toHaveLength(1)
    expect(p).toContain('- Fix b')
    expect(p).not.toContain('zzbodyzz')
  })

  it('mentions the current message when amending', () => {
    const p = buildPrompt({ ...base, amend: true, previousMessage: 'Old subject\n\nOld body' })
    expect(p).toContain('being amended')
    expect(p).toContain('Old subject')
  })
})

describe('output cleaning', () => {
  it('strips fences and surrounding prose', () => {
    expect(cleanCommitMessage('Here you go:\n```\nAdd login form\n\nBecause users.\n```\nHope it helps')).toBe('Add login form\n\nBecause users.')
    expect(cleanCommitMessage('```text\nfix: crash\n```')).toBe('fix: crash')
  })

  it('strips quotes and labels', () => {
    expect(cleanCommitMessage('"Add login form"')).toBe('Add login form')
    expect(cleanCommitMessage("'Add login form'")).toBe('Add login form')
    expect(cleanCommitMessage('Commit message: Add login form')).toBe('Add login form')
    expect(cleanCommitMessage("Here's the commit message:\n\nAdd login form")).toBe('Add login form')
    expect(cleanCommitMessage('**Commit message:**\nAdd login form')).toBe('Add login form')
    // Not a label (no colon) and inner quotes: left alone.
    expect(cleanCommitMessage('Commit message editor gets spellcheck')).toBe('Commit message editor gets spellcheck')
    expect(cleanCommitMessage('"a" and "b" swapped')).toBe('"a" and "b" swapped')
  })

  it('drops co-author / generated trailers, normalises CRLF and blank lines', () => {
    const raw = 'Add x\r\nwhy it matters  \r\n\r\n\r\n\r\nmore\r\n\r\nCo-Authored-By: Claude <noreply@anthropic.com>\r\n🤖 Generated with [Claude Code](https://claude.com)\r\nSigned-off-by: Bot <b@x>\r\n'
    expect(cleanCommitMessage(raw)).toBe('Add x\n\nwhy it matters\n\nmore')
  })

  it('returns empty for empty output', () => {
    expect(cleanCommitMessage('  \n```\n```\n')).toBe('')
    expect(cleanCommitMessage('Co-Authored-By: x <y>')).toBe('')
  })
})

describe('tool detection and invocation', () => {
  it('prefers a real .exe over a .cmd shim on Windows', () => {
    const env = { Path: 'C:\\npm;C:\\bin', USERPROFILE: 'C:\\Users\\u' }
    const files = new Set([win32.join('C:\\npm', 'codex.cmd'), win32.join('C:\\bin', 'codex.exe')])
    const p = resolveBinary(['codex'], 'win32', env, (x) => files.has(x))
    expect(p?.toLowerCase().endsWith('codex.exe')).toBe(true)
  })

  it('finds cursor under either binary name and honours overrides', () => {
    const env = { PATH: '/x', HOME: '/home/u', GITCLIENT_AI_CLAUDE_PATH: '/fake/claude.js' }
    const found = new Set(['/home/u/.local/bin/cursor-agent', '/fake/claude.js', '/home/u/.local/bin/claude'])
    const tools = detectTools('linux', env, (p) => found.has(p))
    expect(tools.find((t) => t.id === 'cursor')?.path).toBe('/home/u/.local/bin/cursor-agent')
    expect(tools.find((t) => t.id === 'claude')?.path).toBe('/fake/claude.js')
    expect(tools.find((t) => t.id === 'gemini')?.path).toBeNull()
    const none = detectTools('linux', { ...env, GITCLIENT_AI_NO_PATH_SEARCH: '1' }, (p) => found.has(p))
    expect(none.filter((t) => t.path).map((t) => t.id)).toEqual(['claude'])
  })

  it('runs scripts with our runtime, shims through cmd.exe, others directly', () => {
    expect(buildInvocation('/t/fake.mjs', ['-p'], 'linux', {}, '/usr/bin/node')).toEqual({
      command: '/usr/bin/node',
      args: ['/t/fake.mjs', '-p'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
    expect(buildInvocation('/usr/bin/claude', ['-p'], 'linux')).toEqual({ command: '/usr/bin/claude', args: ['-p'] })
    const shim = buildInvocation('C:\\Users\\a b\\npm\\codex.cmd', AI_TOOL_SPECS.claude.args(''), 'win32', { ComSpec: 'C:\\Windows\\cmd.exe' })
    expect(shim.command).toBe('C:\\Windows\\cmd.exe')
    expect(shim.windowsVerbatimArguments).toBe(true)
    expect(shim.args).toEqual([
      '/d',
      '/v:off',
      '/s',
      '/c',
      '""C:\\Users\\a b\\npm\\codex.cmd" -p --output-format text --tools "" --no-session-persistence --disable-slash-commands"'
    ])
    expect(() => buildInvocation('C:\\100%\\x.cmd', [], 'win32', {})).toThrow(/unsupported character/)
  })

  it('never puts a prompt in argv', () => {
    for (const spec of Object.values(AI_TOOL_SPECS)) {
      for (const a of spec.args('/tmp/out.txt')) expect(a.length).toBeLessThan(40)
    }
  })
})

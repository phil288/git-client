import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { GitService } from '../../src/main/git/GitService'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import { OperationManager } from '../../src/main/operations'
import { commitFile, git, initRepo, tempDir, write } from '../helpers'

let service: GitService
let logger: CommandLogger
const root = tempDir()

beforeAll(async () => {
  const status = await locateGit(null)
  if (status.state !== 'ok') throw new Error('git not available for tests')
  logger = new CommandLogger()
  service = new GitService(new GitRunner(status.git.path, logger))
})

describe('GitService.resolve', () => {
  it('maps a subfolder (and a file) to the repository root', async () => {
    const repo = initRepo(join(root, 'resolve-basic'))
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true })
    expect(await service.resolve(join(repo, 'src', 'deep'))).toEqual({ kind: 'repo', root: repo })
    expect(await service.resolve(join(repo, 'README.md'))).toEqual({ kind: 'repo', root: repo })
  })

  it('reports non-repositories and missing paths', async () => {
    const plain = join(root, 'plain')
    mkdirSync(plain)
    expect(await service.resolve(plain)).toEqual({ kind: 'not-repo', path: plain })
    expect((await service.resolve(join(root, 'nope'))).kind).toBe('missing')
  })

  it('opening the .git folder opens its working tree', async () => {
    const repo = initRepo(join(root, 'resolve-gitdir'))
    expect(await service.resolve(join(repo, '.git'))).toEqual({ kind: 'repo', root: repo })
  })

  it('detects bare repositories', async () => {
    const bare = join(root, 'bare.git')
    git(root, 'init', '-q', '--bare', bare)
    expect((await service.resolve(bare)).kind).toBe('bare')
  })

  it('handles paths with spaces and unicode', async () => {
    const repo = initRepo(join(root, 'My Repo — ünïcode'))
    expect(await service.resolve(repo)).toEqual({ kind: 'repo', root: repo })
    expect((await service.info(repo)).name).toBe('My Repo — ünïcode')
  })
})

describe('GitService.init', () => {
  it('initialises a folder and resolves it', async () => {
    const dir = join(root, 'fresh')
    mkdirSync(dir)
    expect(await service.init(dir)).toEqual({ kind: 'repo', root: dir })
    const info = await service.info(dir)
    expect(info).toMatchObject({ branch: 'main', unborn: true, detached: false, headSha: null })
  })
})

describe('GitService.info', () => {
  it('reports branch, HEAD and detached state', async () => {
    const repo = initRepo(join(root, 'info'))
    const info = await service.info(repo)
    expect(info.branch).toBe('main')
    expect(info.headSha).toMatch(/^[0-9a-f]{40}$/)
    expect(info.isLinkedWorktree).toBe(false)
    expect(info.superproject).toBeNull()
    expect(info.inProgress).toEqual([])

    git(repo, 'checkout', '-q', '--detach')
    expect(await service.info(repo)).toMatchObject({ branch: null, detached: true })
  })

  it('detects linked worktrees', async () => {
    const repo = initRepo(join(root, 'wt-main'))
    const wt = join(root, 'wt-linked')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', wt)
    const info = await service.info(wt)
    expect(info).toMatchObject({ isLinkedWorktree: true, branch: 'feature', commonDir: join(repo, '.git') })
    expect((await service.resolve(wt)).kind).toBe('repo')
  })

  it('detects submodules and their parent', async () => {
    const lib = initRepo(join(root, 'sub-lib'))
    const parent = initRepo(join(root, 'sub-parent'))
    git(parent, 'submodule', 'add', '-q', lib, 'libs/lib')
    const subPath = join(parent, 'libs', 'lib')
    const info = await service.info(subPath)
    expect(info.superproject).toBe(parent)
    expect(await service.resolve(join(subPath, 'README.md'))).toEqual({ kind: 'repo', root: subPath })
  })

  it('detects an in-progress merge with conflicts', async () => {
    const repo = initRepo(join(root, 'merge-conflict'))
    git(repo, 'checkout', '-q', '-b', 'other')
    commitFile(repo, 'README.md', 'other\n', 'other change')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'README.md', 'main\n', 'main change')
    expect(() => git(repo, 'merge', 'other')).toThrow()
    expect((await service.info(repo)).inProgress).toEqual(['merge'])
    const qs = await service.quickStatus(repo)
    expect(qs.dirty).toBe(true)
  })

  it('detects an in-progress rebase', async () => {
    const repo = initRepo(join(root, 'rebase-conflict'))
    git(repo, 'checkout', '-q', '-b', 'topic')
    commitFile(repo, 'README.md', 'topic\n', 'topic change')
    git(repo, 'checkout', '-q', 'main')
    commitFile(repo, 'README.md', 'main\n', 'main change')
    git(repo, 'checkout', '-q', 'topic')
    expect(() => git(repo, 'rebase', 'main')).toThrow()
    expect((await service.info(repo)).inProgress).toEqual(['rebase'])
  })
})

describe('GitService.quickStatus', () => {
  it('reports dirty state and ahead/behind against the upstream', async () => {
    const origin = join(root, 'qs-origin.git')
    git(root, 'init', '-q', '--bare', origin)
    const seed = initRepo(join(root, 'qs-seed'))
    git(seed, 'remote', 'add', 'origin', origin)
    git(seed, 'push', '-q', '-u', 'origin', 'main')

    const clone = join(root, 'qs-clone')
    git(root, 'clone', '-q', origin, clone)
    commitFile(seed, 'a.txt', 'a\n', 'a')
    commitFile(seed, 'b.txt', 'b\n', 'b')
    git(seed, 'push', '-q')
    git(clone, 'fetch', '-q')
    commitFile(clone, 'c.txt', 'c\n', 'c')

    let s = await service.quickStatus(clone)
    expect(s).toMatchObject({ isRepo: true, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2, dirty: false })

    write(clone, 'untracked.txt', 'x')
    s = await service.quickStatus(clone)
    expect(s).toMatchObject({ dirty: true, changedCount: 1 })
  })

  it('is safe for missing folders and non-repos', async () => {
    expect(await service.quickStatus(join(root, 'nope'))).toMatchObject({ exists: false, isRepo: false })
    const plain = join(root, 'qs-plain')
    mkdirSync(plain)
    expect(await service.quickStatus(plain)).toMatchObject({ exists: true, isRepo: false })
  })
})

describe('GitService.clone', () => {
  it('clones with progress and returns the new root', async () => {
    const src = initRepo(join(root, 'clone-src'))
    for (let i = 0; i < 20; i++) write(src, `f${i}.txt`, `file ${i}\n`.repeat(200))
    git(src, 'add', '.')
    git(src, 'commit', '-q', '-m', 'many files')
    const dest = join(root, 'clone dest with spaces')
    const lines: string[] = []
    const result = await service.clone({ url: `file://${src}`, destination: dest }, new AbortController().signal, (p) => lines.push(p.line))
    expect(result).toBe(dest)
    expect(existsSync(join(dest, 'f19.txt'))).toBe(true)
    expect(lines.length).toBeGreaterThan(0)
  })

  it('refuses option-looking URLs and non-empty destinations', async () => {
    const signal = new AbortController().signal
    await expect(service.clone({ url: '--upload-pack=touch /tmp/x', destination: join(root, 'x1') }, signal, () => {})).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    const full = join(root, 'full')
    mkdirSync(full)
    writeFileSync(join(full, 'x'), 'x')
    await expect(service.clone({ url: 'https://example.invalid/r.git', destination: full }, signal, () => {})).rejects.toMatchObject({
      code: 'ALREADY_EXISTS'
    })
  })

  it('can be cancelled through the OperationManager', async () => {
    const ops = new OperationManager()
    const src = initRepo(join(root, 'cancel-src'))
    const p = ops.run('op1', 'clone', true, (op) =>
      service.clone({ url: `file://${src}`, destination: join(root, 'cancel-dest') }, op.signal, () => {})
    )
    ops.cancel('op1')
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
  })
})

describe('GitRunner', () => {
  it('passes arguments verbatim, never through a shell', async () => {
    const repo = initRepo(join(root, 'no-shell'))
    const marker = join(root, 'pwned')
    const message = `evil $(touch ${marker}) \`touch ${marker}\` ; touch ${marker} && echo "q" 'q' | cat > x`
    await service.runner.run(['commit', '--allow-empty', '-q', '-m', message], { cwd: repo })
    expect(existsSync(marker)).toBe(false)
    expect(git(repo, 'log', '-1', '--format=%B').trim()).toBe(message)
  })

  it('logs every command with exit code and stderr', async () => {
    const repo = initRepo(join(root, 'logged'))
    await expect(service.runner.run(['rev-parse', '--verify', 'does-not-exist'], { cwd: repo })).rejects.toMatchObject({
      code: 'GIT_FAILED'
    })
    const last = logger.list().at(-1)!
    expect(last.args).toEqual(['rev-parse', '--verify', 'does-not-exist'])
    expect(last.exitCode).not.toBe(0)
    expect(last.running).toBe(false)
    expect(last.stderr).toMatch(/fatal/)
  })

  it('preserves CRLF content byte-for-byte on stdout', async () => {
    const repo = initRepo(join(root, 'crlf'))
    write(repo, 'win.txt', 'a\r\nb\r\n')
    git(repo, '-c', 'core.autocrlf=false', 'add', 'win.txt')
    git(repo, 'commit', '-q', '-m', 'crlf')
    const r = await service.runner.run(['-c', 'core.autocrlf=false', 'show', 'HEAD:win.txt'], { cwd: repo })
    expect(r.stdout).toBe('a\r\nb\r\n')
    expect(readFileSync(join(repo, 'win.txt'), 'utf8')).toBe('a\r\nb\r\n')
  })
})

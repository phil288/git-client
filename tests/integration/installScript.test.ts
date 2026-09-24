import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { tempDir } from '../helpers'

const SCRIPT = resolve(__dirname, '../../install.sh')
const ASSET = 'gitclient-linux-x64.tar.gz'
const run = platform() === 'linux' && arch() === 'x64'

describe.runIf(run)('install.sh --user (against a fake file:// release)', () => {
  const root = tempDir('gitclient-install-')
  const releases = join(root, 'releases')
  const home = join(root, 'home')

  /** Builds download/<tag>/{tar.gz, SHA256SUMS} like the GitHub release. */
  function makeRelease(tag: string, opts: { corruptSum?: boolean } = {}): void {
    const stage = join(root, 'stage', tag, `gitclient-${tag.slice(1)}`)
    mkdirSync(join(stage, 'resources'), { recursive: true })
    writeFileSync(join(stage, 'gitclient'), `#!/bin/sh\necho gitclient ${tag}\n`)
    chmodSync(join(stage, 'gitclient'), 0o755)
    writeFileSync(join(stage, 'chrome-sandbox'), '')
    writeFileSync(join(stage, 'resources', 'icon.png'), 'png')
    const out = join(releases, 'download', tag)
    mkdirSync(out, { recursive: true })
    const tar = spawnSync('tar', ['-czf', join(out, ASSET), '-C', join(root, 'stage', tag), `gitclient-${tag.slice(1)}`])
    expect(tar.status).toBe(0)
    const hash = opts.corruptSum ? '0'.repeat(64) : createHash('sha256').update(readFileSync(join(out, ASSET))).digest('hex')
    writeFileSync(join(out, 'SHA256SUMS'), `${'f'.repeat(64)}  gitclient-linux-x64.deb\n${hash}  ${ASSET}\n`)
  }

  function install(...args: string[]) {
    const r = spawnSync('bash', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: home,
        NO_COLOR: '1',
        GITCLIENT_RELEASES_URL: pathToFileURL(releases).toString()
      }
    })
    return { code: r.status, out: r.stdout + r.stderr }
  }

  const share = join(home, '.local', 'share')
  const appDir = join(share, 'gitclient')

  beforeAll(() => {
    mkdirSync(home, { recursive: true })
    makeRelease('v0.1.0')
    makeRelease('v0.2.0')
    makeRelease('v0.3.0', { corruptSum: true })
  })

  it('installs into ~/.local with launcher, desktop entry and icon', () => {
    const r = install('--user', '--version', '0.1.0')
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('Checksum verified')
    expect(r.out).toContain('GitClient v0.1.0 installed')
    expect(r.out).toContain('is not on your PATH')
    expect(readFileSync(join(appDir, '.installed-version'), 'utf8').trim()).toBe('v0.1.0')
    const link = join(home, '.local', 'bin', 'gitclient')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(join(appDir, 'gitclient'))
    expect(spawnSync(link, { encoding: 'utf8' }).stdout.trim()).toBe('gitclient v0.1.0')
    const desktop = readFileSync(join(share, 'applications', 'gitclient.desktop'), 'utf8')
    expect(desktop).toContain(`Exec="${join(appDir, 'gitclient')}" %U`)
    expect(desktop).toContain('Icon=gitclient')
    expect(existsSync(join(share, 'icons', 'hicolor', '512x512', 'apps', 'gitclient.png'))).toBe(true)
    expect(r.out).not.toContain('--no-sandbox\n')
  })

  it('is idempotent and upgrades in place', () => {
    const r = install('--user', '--version', 'v0.2.0')
    expect(r.code, r.out).toBe(0)
    expect(readFileSync(join(appDir, '.installed-version'), 'utf8').trim()).toBe('v0.2.0')
    expect(existsSync(`${appDir}.old`)).toBe(false)
  })

  it('refuses a download whose checksum does not match and keeps the current install', () => {
    const r = install('--user', '--version', 'v0.3.0')
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('Checksum mismatch')
    expect(readFileSync(join(appDir, '.installed-version'), 'utf8').trim()).toBe('v0.2.0')
  })

  it('reports a missing release clearly', () => {
    const r = install('--user', '--version', 'v9.9.9')
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('Download failed')
  })

  it('uninstalls but keeps settings unless --purge', () => {
    const config = join(home, '.config', 'GitClient')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, 'gitclient-state.json'), '{}')

    let r = install('--uninstall', '--user')
    expect(r.code, r.out).toBe(0)
    expect(existsSync(appDir)).toBe(false)
    expect(existsSync(join(home, '.local', 'bin', 'gitclient'))).toBe(false)
    expect(existsSync(join(share, 'applications', 'gitclient.desktop'))).toBe(false)
    expect(existsSync(config)).toBe(true)
    expect(r.out).toContain('Settings kept')

    r = install('--uninstall', '--user', '--purge')
    expect(r.code, r.out).toBe(0)
    expect(existsSync(config)).toBe(false)
  })

  it('rejects unknown options and --purge without --uninstall', () => {
    expect(install('--bogus').code).toBe(1)
    expect(install('--purge').code).toBe(1)
    expect(install('--help').out).toContain('Usage: install.sh')
  })
})

describe.runIf(run)('install.sh from a repository clone (local build)', () => {
  const root = tempDir('gitclient-install-local-')
  const checkout = join(root, 'checkout')
  const home = join(root, 'home')
  const fakeBin = join(root, 'bin')
  const npmLog = join(root, 'npm.log')
  const template = join(root, 'template.tar.gz')
  const dist = join(checkout, 'dist', ASSET)
  const appDir = join(home, '.local', 'share', 'gitclient')

  beforeAll(() => {
    mkdirSync(join(checkout, 'src'), { recursive: true })
    mkdirSync(join(checkout, 'dist'), { recursive: true })
    mkdirSync(home, { recursive: true })
    mkdirSync(fakeBin, { recursive: true })
    copyFileSync(SCRIPT, join(checkout, 'install.sh'))
    writeFileSync(join(checkout, 'package.json'), '{\n  "name": "gitclient",\n  "version": "0.4.2"\n}\n')
    writeFileSync(join(checkout, 'package-lock.json'), '{}\n')
    writeFileSync(join(checkout, 'electron-builder.yml'), 'appId: test\n')
    writeFileSync(join(checkout, 'src', 'index.ts'), '// source\n')

    const stage = join(root, 'stage', 'gitclient-0.4.2')
    mkdirSync(stage, { recursive: true })
    writeFileSync(join(stage, 'gitclient'), '#!/bin/sh\necho local build\n')
    chmodSync(join(stage, 'gitclient'), 0o755)
    expect(spawnSync('tar', ['-czf', template, '-C', join(root, 'stage'), 'gitclient-0.4.2']).status).toBe(0)

    // Fake npm: logs its arguments; "exec … electron-builder" produces the package.
    writeFileSync(
      join(fakeBin, 'npm'),
      `#!/bin/sh\necho "$*" >> "${npmLog}"\ncase "$*" in *electron-builder*) cp "${template}" "${dist}" ;; esac\n`
    )
    chmodSync(join(fakeBin, 'npm'), 0o755)
  })

  function install(args: string[], opts: { withNpm?: boolean } = {}) {
    const path = [opts.withNpm === false ? '' : fakeBin, '/usr/bin', '/bin'].filter(Boolean).join(':')
    const r = spawnSync('bash', [join(checkout, 'install.sh'), ...args], {
      encoding: 'utf8',
      env: { PATH: path, HOME: home, NO_COLOR: '1', GITCLIENT_RELEASES_URL: 'file:///nonexistent/releases' }
    })
    return { code: r.status, out: r.stdout + r.stderr }
  }
  const npmCalls = () => (existsSync(npmLog) ? readFileSync(npmLog, 'utf8').trim().split('\n') : [])
  const age = (file: string, secondsAgo: number) => {
    const t = Date.now() / 1000 - secondsAgo
    utimesSync(file, t, t)
  }

  it('installs an up-to-date dist/ package without downloading or building', () => {
    copyFileSync(template, dist)
    age(join(checkout, 'src', 'index.ts'), 3600)
    for (const f of ['package.json', 'package-lock.json', 'electron-builder.yml']) age(join(checkout, f), 3600)
    const r = install(['--user'])
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('Using the local build')
    expect(r.out).not.toContain('Downloading')
    expect(npmCalls()).toEqual([])
    expect(readFileSync(join(appDir, '.installed-version'), 'utf8').trim()).toBe('v0.4.2-local')
    expect(spawnSync(join(home, '.local', 'bin', 'gitclient'), { encoding: 'utf8' }).stdout.trim()).toBe('local build')
  })

  it('rebuilds when sources are newer than the package (npm ci first when node_modules is missing)', () => {
    age(dist, 7200)
    const r = install(['--user'])
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('sources changed since dist/')
    expect(npmCalls()).toEqual(['ci', 'run build', 'exec --no -- electron-builder --linux tar.gz --x64 --publish never'])
  })

  it('builds when dist/ is missing and skips npm ci when node_modules exists', () => {
    rmSync(npmLog, { force: true })
    rmSync(dist)
    mkdirSync(join(checkout, 'node_modules'), { recursive: true })
    const r = install(['--user'])
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('has not been built yet')
    expect(npmCalls()).toEqual(['run build', 'exec --no -- electron-builder --linux tar.gz --x64 --publish never'])
  })

  it('--rebuild forces a build', () => {
    rmSync(npmLog, { force: true })
    const r = install(['--user', '--rebuild'])
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('--rebuild requested')
    expect(npmCalls()).toHaveLength(2)
  })

  it('--remote and --version bypass the local build', () => {
    rmSync(npmLog, { force: true })
    for (const args of [['--user', '--remote'], ['--user', '--version', 'v0.1.0']]) {
      const r = install(args)
      expect(r.code).not.toBe(0)
      expect(r.out).toContain('file:///nonexistent/releases')
    }
    expect(npmCalls()).toEqual([])
    expect(install(['--remote', '--rebuild']).code).toBe(1)
  })

  it('explains what to do when there is no package and no npm', () => {
    const hasSystemNpm = spawnSync('bash', ['-c', 'PATH=/usr/bin:/bin command -v npm']).status === 0
    if (hasSystemNpm) return
    rmSync(dist, { force: true })
    const r = install(['--user'], { withNpm: false })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('npm is not installed')
    expect(r.out).toContain('--remote')
  })
})

describe('install.sh configuration', () => {
  it('uses the same <OWNER>/<REPO> as package.json "repository"', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { repository: { url: string } }
    const slug = /github\.com\/(.+?)(?:\.git)?$/.exec(pkg.repository.url)?.[1]
    const script = readFileSync(SCRIPT, 'utf8')
    expect(script).toContain(`local DEFAULT_REPO='${slug}'`)
  })

  it('install.ps1 uses the same <OWNER>/<REPO>', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { repository: { url: string } }
    const slug = /github\.com\/(.+?)(?:\.git)?$/.exec(pkg.repository.url)?.[1]
    expect(readFileSync(resolve(__dirname, '../../install.ps1'), 'utf8')).toContain(`$DefaultRepo = '${slug}'`)
  })

  it('wraps everything in main() called on the last line', () => {
    const lines = readFileSync(SCRIPT, 'utf8').trimEnd().split('\n')
    expect(lines.at(-1)).toBe('main "$@"')
    expect(readFileSync(SCRIPT, 'utf8')).toContain('set -euo pipefail')
  })
})

import { describe, expect, it } from 'vitest'
import { parseRemoteUrl, redactUrl, remoteNameError, suggestRemoteName, urlHint } from '@shared/remotes'

describe('parseRemoteUrl', () => {
  it('parses scp-like SSH URLs of known providers and derives the other forms', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo.git')).toEqual({
      protocol: 'ssh',
      host: 'github.com',
      path: 'owner/repo',
      provider: 'GitHub',
      webUrl: 'https://github.com/owner/repo',
      sshUrl: 'git@github.com:owner/repo.git',
      httpsUrl: 'https://github.com/owner/repo.git',
      hasPassword: false
    })
  })

  it('parses HTTPS, ssh:// with port, and SSH host aliases', () => {
    expect(parseRemoteUrl('https://gitlab.com/group/sub/proj')).toMatchObject({ protocol: 'https', provider: 'GitLab', path: 'group/sub/proj', sshUrl: 'git@gitlab.com:group/sub/proj.git' })
    expect(parseRemoteUrl('ssh://git@ssh.github.com:443/o/r.git')).toMatchObject({ protocol: 'ssh', host: 'ssh.github.com', provider: 'GitHub', webUrl: 'https://github.com/o/r' })
    expect(parseRemoteUrl('git+ssh://me@example.com/srv/repo.git')).toMatchObject({ protocol: 'ssh', provider: null, webUrl: null, sshUrl: null })
  })

  it('handles Azure DevOps SSH and HTTPS forms', () => {
    expect(parseRemoteUrl('git@ssh.dev.azure.com:v3/org/proj/repo').webUrl).toBe('https://dev.azure.com/org/proj/_git/repo')
    expect(parseRemoteUrl('https://org@dev.azure.com/org/proj/_git/repo')).toMatchObject({ provider: 'Azure DevOps', webUrl: 'https://dev.azure.com/org/proj/_git/repo', sshUrl: null })
  })

  it('gives a web URL for unknown HTTPS hosts only', () => {
    expect(parseRemoteUrl('https://git.example.com/a/b.git').webUrl).toBe('https://git.example.com/a/b')
    expect(parseRemoteUrl('git@git.example.com:a/b.git').webUrl).toBeNull()
    expect(parseRemoteUrl('http://git.example.com/a/b.git')).toMatchObject({ protocol: 'http', webUrl: null })
  })

  it('recognises local paths, file:// and garbage', () => {
    expect(parseRemoteUrl('/srv/git/x.git').protocol).toBe('local')
    expect(parseRemoteUrl('../sibling').protocol).toBe('local')
    expect(parseRemoteUrl('C:\\repos\\x').protocol).toBe('local')
    expect(parseRemoteUrl('file:///srv/x.git')).toMatchObject({ protocol: 'file', path: '/srv/x.git' })
    expect(parseRemoteUrl('not a url').protocol).toBe('unknown')
    expect(parseRemoteUrl('').protocol).toBe('unknown')
  })

  it('detects and redacts embedded passwords', () => {
    const u = 'https://user:ghp_secret@github.com/o/r.git'
    expect(parseRemoteUrl(u).hasPassword).toBe(true)
    expect(redactUrl(u)).toBe('https://user:•••@github.com/o/r.git')
    expect(redactUrl('https://user@github.com/o/r.git')).toBe('https://user@github.com/o/r.git')
    expect(redactUrl('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')
  })
})

describe('urlHint', () => {
  it('describes valid URLs and warns about risky ones', () => {
    expect(urlHint('')).toBeNull()
    expect(urlHint('git@github.com:o/r.git')).toEqual({ tone: 'info', text: 'GitHub · SSH · o/r' })
    expect(urlHint('nonsense')?.tone).toBe('warning')
    expect(urlHint('https://a:b@x.com/r')?.text).toMatch(/password/)
    expect(urlHint('http://x.com/r')?.text).toMatch(/not encrypted/)
    expect(urlHint('https://x.com/a b')?.text).toMatch(/spaces/)
    expect(urlHint('/home/me/My Repos/x.git')).toEqual({ tone: 'info', text: 'Local folder · /home/me/My Repos/x.git' })
  })
})

describe('remote names', () => {
  it('validates like git and rejects duplicates', () => {
    expect(remoteNameError('origin', [])).toBeNull()
    expect(remoteNameError('team/fork', [])).toBeNull()
    expect(remoteNameError('', [])).toMatch(/Enter/)
    expect(remoteNameError('my remote', [])).toMatch(/spaces/)
    expect(remoteNameError('-x', [])).toMatch(/start/)
    expect(remoteNameError('a..b', [])).toBeTruthy()
    expect(remoteNameError('a:b', [])).toBeTruthy()
    expect(remoteNameError('x.lock', [])).toBeTruthy()
    expect(remoteNameError('.hidden', [])).toBeTruthy()
    expect(remoteNameError('origin', ['origin'])).toMatch(/already exists/)
  })

  it('suggests origin, then upstream, then the URL owner', () => {
    expect(suggestRemoteName([])).toBe('origin')
    expect(suggestRemoteName(['origin'])).toBe('upstream')
    expect(suggestRemoteName(['origin', 'upstream'], 'git@github.com:Alice/r.git')).toBe('alice')
    expect(suggestRemoteName(['origin', 'upstream'])).toBe('remote2')
  })
})

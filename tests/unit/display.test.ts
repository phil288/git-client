import { describe, expect, it } from 'vitest'
import { baseName, cloneDirName, formatCommand, relativeTime, repoInitials, shortenHome } from '@shared/display'

describe('display helpers', () => {
  it('shortens the home dir on Linux only', () => {
    expect(shortenHome('/home/phil/dev/x', '/home/phil', 'linux')).toBe('~/dev/x')
    expect(shortenHome('/home/phil', '/home/phil', 'linux')).toBe('~')
    expect(shortenHome('/home/philip/x', '/home/phil', 'linux')).toBe('/home/philip/x')
    expect(shortenHome('C:\\Users\\p\\x', 'C:\\Users\\p', 'win32')).toBe('C:\\Users\\p\\x')
  })

  it('baseName handles both separators and trailing slashes', () => {
    expect(baseName('/a/b/repo/')).toBe('repo')
    expect(baseName('C:\\Users\\me\\My Repo')).toBe('My Repo')
  })

  it('computes initials', () => {
    expect(repoInitials('git-manager')).toBe('GM')
    expect(repoInitials('MyRepo')).toBe('MR')
    expect(repoInitials('backend')).toBe('BA')
  })

  it('derives clone folder names', () => {
    expect(cloneDirName('https://github.com/owner/repo.git')).toBe('repo')
    expect(cloneDirName('git@github.com:owner/my-repo.git')).toBe('my-repo')
    expect(cloneDirName('https://example.com/x/y/')).toBe('y')
    expect(cloneDirName('/srv/git/proj.git/')).toBe('proj')
  })

  it('formats commands for display with quoting', () => {
    expect(formatCommand(['commit', '-m', 'hello world'])).toBe('git commit -m "hello world"')
    expect(formatCommand(['status'])).toBe('git status')
  })

  it('relative time', () => {
    const now = 1_000_000_000_000
    expect(relativeTime(now - 10_000, now)).toBe('just now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe('yesterday')
  })
})

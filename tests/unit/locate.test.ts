import { describe, expect, it } from 'vitest'
import { candidateGitPaths, compareVersions, locateGit, parseGitVersion } from '../../src/main/git/locate'

describe('git detection', () => {
  it('parses version strings from all platforms', () => {
    expect(parseGitVersion('git version 2.43.0')).toEqual([2, 43, 0])
    expect(parseGitVersion('git version 2.45.1.windows.1\n')).toEqual([2, 45, 1])
    expect(parseGitVersion('git version 2.39.3 (Apple Git-146)')).toEqual([2, 39, 3])
    expect(parseGitVersion('git version 2.30')).toEqual([2, 30, 0])
    expect(parseGitVersion('nope')).toBeNull()
  })

  it('compares versions', () => {
    expect(compareVersions([2, 30, 0], [2, 30, 0])).toBe(0)
    expect(compareVersions([2, 29, 9], [2, 30, 0])).toBeLessThan(0)
    expect(compareVersions([3, 0, 0], [2, 99, 99])).toBeGreaterThan(0)
  })

  it('lists PATH first, then Windows install locations, only .exe', () => {
    const c = candidateGitPaths('win32', {
      PATH: 'C:\\Tools;"C:\\Quoted Dir"',
      ProgramFiles: 'C:\\Program Files',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\me'
    })
    expect(c[0]).toMatch(/Tools[\\/]git\.exe$/)
    expect(c[1]).toMatch(/Quoted Dir[\\/]git\.exe$/)
    expect(c.some((p) => p.includes('Program Files') && p.endsWith('git.exe'))).toBe(true)
    expect(c.some((p) => p.includes('AppData') && p.includes('Programs'))).toBe(true)
    expect(c.every((p) => p.endsWith('git.exe'))).toBe(true)
  })

  it('finds the real git on this machine', async () => {
    const s = await locateGit(null)
    expect(s.state).toBe('ok')
  })

  it('reports a missing configured path without falling back', async () => {
    const s = await locateGit('/definitely/not/git')
    expect(s).toMatchObject({ state: 'missing', configuredPath: '/definitely/not/git' })
  })
})

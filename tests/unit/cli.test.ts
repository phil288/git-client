import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { extractPathArgs, resolvePathArgs } from '../../src/main/cli'

describe('command line parsing', () => {
  it('packaged: skips the executable and flags', () => {
    expect(extractPathArgs(['/usr/bin/gitclient', '.', '--no-sandbox', '/tmp/x'], false)).toEqual(['.', '/tmp/x'])
  })

  it('dev (defaultApp): skips electron and the entry script', () => {
    expect(extractPathArgs(['electron', 'out/main/index.js', 'repo'], true)).toEqual(['repo'])
  })

  it('treats everything after -- as paths', () => {
    expect(extractPathArgs(['gitclient', '--', '-weird-name'], false)).toEqual(['-weird-name'])
  })

  it('resolves relative paths against the caller cwd', () => {
    expect(resolvePathArgs(['.', 'sub', '/abs'], '/home/u/work')).toEqual([resolve('/home/u/work'), resolve('/home/u/work/sub'), resolve('/abs')])
  })
})

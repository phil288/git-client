import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanForRepos } from '../../src/main/repos/scan'
import { git, initRepo, tempDir, write } from '../helpers'

describe('scanForRepos', () => {
  const root = tempDir()
  initRepo(join(root, 'a'))
  initRepo(join(root, 'work', 'b'))
  initRepo(join(root, 'work', 'deep', 'er', 'c')) // depth 4
  initRepo(join(root, 'node_modules', 'pkg')) // skipped
  initRepo(join(root, 'build', 'artifact')) // skipped
  const wtBase = initRepo(join(root, 'wtbase'))
  git(wtBase, 'worktree', 'add', '-q', '-b', 'w', join(root, 'linked')) // .git is a file
  mkdirSync(join(root, 'empty'))
  write(root, 'a/nested/inner/.keep', '')

  it('finds repos up to max depth, skipping ignored folders and not descending into repos', async () => {
    const found = await scanForRepos(root, { maxDepth: 4 })
    const rel = found.map((p) => p.slice(root.length + 1).replace(/\\/g, '/'))
    expect(rel).toEqual(['a', 'linked', 'work/b', 'work/deep/er/c', 'wtbase'])
  })

  it('respects a smaller depth', async () => {
    const found = await scanForRepos(root, { maxDepth: 1 })
    expect(found.map((p) => p.slice(root.length + 1))).toEqual(['a', 'linked', 'wtbase'])
  })

  it('can be cancelled', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(scanForRepos(root, { maxDepth: 4, signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' })
  })
})

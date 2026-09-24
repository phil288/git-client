import { spawnSync } from 'node:child_process'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileManagerScript } from '../../src/main/fileManagerScript'
import { tempDir } from '../helpers'

describe.runIf(process.platform !== 'win32')('file manager script', () => {
  const dir = tempDir()
  // A fake "gitclient" that prints its argument.
  const fake = join(dir, "fake gitclient's.sh")
  writeFileSync(fake, '#!/bin/sh\nprintf "%s" "$1"\n')
  chmodSync(fake, 0o755)
  const script = join(dir, 'open.sh')
  writeFileSync(script, fileManagerScript('nautilus', fake))
  chmodSync(script, 0o755)
  const run = (env: Record<string, string>) => spawnSync(script, { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...env } }).stdout

  it('opens the first selected path', () => {
    expect(run({ NAUTILUS_SCRIPT_SELECTED_FILE_PATHS: '/home/u/My Repo\n/home/u/other\n' })).toBe('/home/u/My Repo')
  })

  it('falls back to the percent-decoded current folder URI', () => {
    expect(run({ NAUTILUS_SCRIPT_CURRENT_URI: 'file:///home/u/My%20Repo%C3%A9' })).toBe('/home/u/My Repoé')
  })

  it('does nothing without a target', () => {
    expect(run({})).toBe('')
  })

  it('uses Nemo variables for Nemo', () => {
    expect(fileManagerScript('nemo', '/x')).toContain('NEMO_SCRIPT_SELECTED_FILE_PATHS')
  })
})

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Isolate tests from the developer's git configuration: no system config,
 * a throwaway global config with a fixed identity and default branch.
 */
const dir = mkdtempSync(join(tmpdir(), 'gitclient-gitconfig-'))
const globalConfig = join(dir, 'gitconfig')
writeFileSync(
  globalConfig,
  [
    '[user]',
    '\tname = Test User',
    '\temail = test@example.com',
    '[init]',
    '\tdefaultBranch = main',
    '[commit]',
    '\tgpgsign = false',
    '[tag]',
    '\tgpgsign = false',
    '[protocol "file"]',
    '\tallow = always',
    ''
  ].join('\n')
)
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_GLOBAL = globalConfig
process.env.GIT_AUTHOR_DATE = '2024-01-01T00:00:00Z'
process.env.GIT_COMMITTER_DATE = '2024-01-01T00:00:00Z'

// Editor helpers (GIT_EDITOR / GIT_SEQUENCE_EDITOR scripts) run with plain node in tests.
import { initEditors } from '../src/main/git/editors'
initEditors(join(dir, 'helpers'), process.execPath)

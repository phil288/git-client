import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import Store, { type Schema } from 'electron-store'
import type Conf from 'conf'
import { DEFAULT_SETTINGS, type RecentRepo, type RepoGroup, type RepoPrefs, type SessionState, type Settings } from '@shared/types'

export interface PersistedState {
  recents: RecentRepo[]
  groups: RepoGroup[]
  session: SessionState
  settings: Settings
  /** Keyed by pathKey(repo root). */
  repoPrefs: Record<string, RepoPrefs>
}

const nullableString = { type: ['string', 'null'] } as const

const schema: Schema<PersistedState> = {
  recents: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      required: ['path', 'lastOpened'],
      properties: {
        path: { type: 'string' },
        displayName: nullableString,
        lastOpened: { type: 'number' },
        pinned: { type: 'boolean', default: false },
        groupId: nullableString,
        lastBranch: nullableString
      }
    }
  },
  groups: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'string' }, name: { type: 'string' }, collapsed: { type: 'boolean', default: false } }
    }
  },
  session: {
    type: 'object',
    default: { tabs: [], activePath: null },
    properties: {
      tabs: {
        type: 'array',
        items: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, ui: { type: 'object' } } }
      },
      activePath: nullableString
    }
  },
  repoPrefs: {
    type: 'object',
    default: {},
    additionalProperties: {
      type: 'object',
      properties: {
        favorites: { type: 'array', items: { type: 'string' } },
        recentMessages: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  settings: {
    type: 'object',
    default: DEFAULT_SETTINGS,
    properties: {
      reopenLastSession: { type: 'boolean' },
      gitPath: nullableString,
      editorCommand: { type: 'string' },
      terminalCommand: { type: 'string' },
      scanMaxDepth: { type: 'integer', minimum: 0, maximum: 12 },
      theme: { enum: ['system', 'light', 'dark'] },
      showConsole: { type: 'boolean' },
      consoleHeight: { type: 'number', minimum: 80 },
      diffSideBySide: { type: 'boolean' },
      diffIgnoreWhitespace: { type: 'boolean' },
      pullMode: { enum: ['merge', 'rebase', 'ff-only'] },
      autoFetchMinutes: { enum: [0, 5, 15] },
      dateFormat: { enum: ['relative', 'absolute', 'iso'] },
      confirmPush: { type: 'boolean' },
      checkForUpdates: { type: 'boolean' },
      mergeTool: { type: 'string' }
    }
  }
}

/**
 * Migrations keyed by app version (electron-store convention). Each one must
 * be idempotent. Add new entries when the persisted shape changes.
 */
const migrations = {
  '0.1.0': (store: Conf<PersistedState>) => {
    // Fill fields that older/hand-edited files may lack.
    const recents = (store.get('recents') ?? []).map((r) => ({
      ...r,
      displayName: r.displayName ?? null,
      pinned: r.pinned ?? false,
      groupId: r.groupId ?? null,
      lastBranch: r.lastBranch ?? null
    }))
    store.set('recents', recents)
    store.set('settings', { ...DEFAULT_SETTINGS, ...(store.get('settings') ?? {}) })
  }
}

const FILE_NAME = 'gitclient-state'

function create(): Store<PersistedState> {
  return new Store<PersistedState>({
    name: FILE_NAME,
    schema,
    migrations, // electron-store uses app.getVersion() as the project version
    // Writes go through a temp file + rename (conf uses `atomically`), so a
    // crash mid-write never leaves a half-written file.
    clearInvalidConfig: false
  })
}

/**
 * Opens the store. A file that fails JSON parsing or schema validation is
 * moved aside (not deleted) and a fresh store is created.
 */
export function openStore(): Store<PersistedState> {
  try {
    return create()
  } catch (err) {
    const file = join(app.getPath('userData'), `${FILE_NAME}.json`)
    if (existsSync(file)) {
      const backup = join(app.getPath('userData'), `${FILE_NAME}.corrupt-${Date.now()}.json`)
      renameSync(file, backup)
      console.error(`State file was invalid and was moved to ${backup}:`, err)
    }
    return create()
  }
}

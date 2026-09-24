import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type Store from 'electron-store'
import type { RecentsState, RepoGroup } from '@shared/types'
import { normalizeRepoPath, pathKey } from '../paths'
import type { PersistedState } from '../store'
import * as model from './recentsModel'

/** Applies recentsModel transitions to the persistent store and broadcasts changes. */
export class RecentsService extends EventEmitter<{ changed: [RecentsState] }> {
  private readonly key = (p: string): string => pathKey(p)

  constructor(private readonly store: Store<PersistedState>) {
    super()
  }

  private data(): model.RecentsData {
    return { repos: this.store.get('recents'), groups: this.store.get('groups') }
  }

  private commit(next: model.RecentsData): RecentsState {
    this.store.set('recents', next.repos)
    this.store.set('groups', next.groups)
    const state = this.view(next)
    this.emit('changed', state)
    return state
  }

  private view(data: model.RecentsData): RecentsState {
    return { repos: data.repos.map((r) => ({ ...r, exists: existsSync(r.path) })), groups: data.groups }
  }

  list(): RecentsState {
    return this.view(this.data())
  }

  /** Most recently opened first (for the File → Open Recent menu, jump list). */
  mostRecent(limit: number): { path: string; name: string }[] {
    return model
      .byRecency(this.data().repos)
      .slice(0, limit)
      .map((r) => ({ path: r.path, name: r.displayName ?? r.path.split(/[\\/]/).pop() ?? r.path }))
  }

  touch(path: string, branch: string | null): RecentsState {
    return this.commit(model.touch(this.data(), normalizeRepoPath(path), branch, Date.now(), this.key))
  }

  addMany(paths: string[], groupId: string | null): RecentsState {
    return this.commit(model.addMany(this.data(), paths.map((p) => normalizeRepoPath(p)), groupId, Date.now(), this.key))
  }

  remove(paths: string[]): RecentsState {
    return this.commit(model.remove(this.data(), paths, this.key))
  }

  setPinned(path: string, pinned: boolean): RecentsState {
    return this.commit(model.setPinned(this.data(), path, pinned, this.key))
  }

  rename(path: string, displayName: string | null): RecentsState {
    return this.commit(model.rename(this.data(), path, displayName, this.key))
  }

  moveToGroup(path: string, groupId: string | null): RecentsState {
    return this.commit(model.moveToGroup(this.data(), path, groupId, this.key))
  }

  locate(oldPath: string, newPath: string): RecentsState {
    return this.commit(model.locate(this.data(), oldPath, normalizeRepoPath(newPath), this.key))
  }

  removeMissing(): RecentsState {
    return this.commit(model.removeMissing(this.data(), existsSync))
  }

  clear(): RecentsState {
    return this.commit(model.clearRecent(this.data()))
  }

  createGroup(name: string): RepoGroup {
    const id = randomUUID()
    const next = model.createGroup(this.data(), id, name)
    this.commit(next)
    return next.groups.find((g) => g.id === id)!
  }

  renameGroup(id: string, name: string): RecentsState {
    return this.commit(model.renameGroup(this.data(), id, name))
  }

  deleteGroup(id: string): RecentsState {
    return this.commit(model.deleteGroup(this.data(), id))
  }

  setGroupCollapsed(id: string, collapsed: boolean): RecentsState {
    return this.commit(model.setGroupCollapsed(this.data(), id, collapsed))
  }
}

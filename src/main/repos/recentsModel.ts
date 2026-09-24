import type { RecentRepo, RepoGroup } from '@shared/types'

/**
 * Pure state transitions for the recent-repositories list. No I/O here so it
 * is unit-testable; RecentsService applies these to the persistent store.
 */

export const MAX_RECENTS = 50

export interface RecentsData {
  repos: RecentRepo[]
  groups: RepoGroup[]
}

export type KeyFn = (path: string) => string

function indexOf(data: RecentsData, path: string, key: KeyFn): number {
  const k = key(path)
  return data.repos.findIndex((r) => key(r.path) === k)
}

/**
 * Keeps at most MAX_RECENTS non-pinned entries; pinned and grouped entries
 * are kept regardless (the user curated them). Oldest are dropped first.
 */
export function prune(data: RecentsData, max = MAX_RECENTS): RecentsData {
  const disposable = data.repos.filter((r) => !r.pinned && r.groupId === null).sort((a, b) => b.lastOpened - a.lastOpened)
  if (disposable.length <= max) return data
  const drop = new Set(disposable.slice(max))
  return { ...data, repos: data.repos.filter((r) => !drop.has(r)) }
}

/** Records that a repo was opened (adds it or bumps lastOpened). */
export function touch(data: RecentsData, path: string, branch: string | null, now: number, key: KeyFn): RecentsData {
  const i = indexOf(data, path, key)
  const repos = [...data.repos]
  if (i >= 0) {
    const cur = repos[i]!
    repos[i] = { ...cur, path, lastOpened: now, lastBranch: branch ?? cur.lastBranch }
  } else {
    repos.push({ path, displayName: null, lastOpened: now, pinned: false, groupId: null, lastBranch: branch })
  }
  return prune({ ...data, repos })
}

/** Adds several repos (scan results) without bumping existing ones. */
export function addMany(data: RecentsData, paths: string[], groupId: string | null, now: number, key: KeyFn): RecentsData {
  const repos = [...data.repos]
  paths.forEach((path, n) => {
    const i = repos.findIndex((r) => key(r.path) === key(path))
    if (i >= 0) {
      if (groupId !== null) repos[i] = { ...repos[i]!, groupId }
    } else {
      // Slightly decreasing timestamps keep the scan order stable.
      repos.push({ path, displayName: null, lastOpened: now - n, pinned: false, groupId, lastBranch: null })
    }
  })
  return prune({ ...data, repos })
}

export function remove(data: RecentsData, paths: string[], key: KeyFn): RecentsData {
  const keys = new Set(paths.map(key))
  return { ...data, repos: data.repos.filter((r) => !keys.has(key(r.path))) }
}

function update(data: RecentsData, path: string, key: KeyFn, fn: (r: RecentRepo) => RecentRepo): RecentsData {
  const i = indexOf(data, path, key)
  if (i < 0) return data
  const repos = [...data.repos]
  repos[i] = fn(repos[i]!)
  return { ...data, repos }
}

export function setPinned(data: RecentsData, path: string, pinned: boolean, key: KeyFn): RecentsData {
  return prune(update(data, path, key, (r) => ({ ...r, pinned })))
}

export function rename(data: RecentsData, path: string, displayName: string | null, key: KeyFn): RecentsData {
  const name = displayName?.trim() ? displayName.trim() : null
  return update(data, path, key, (r) => ({ ...r, displayName: name }))
}

export function moveToGroup(data: RecentsData, path: string, groupId: string | null, key: KeyFn): RecentsData {
  if (groupId !== null && !data.groups.some((g) => g.id === groupId)) return data
  return prune(update(data, path, key, (r) => ({ ...r, groupId })))
}

/**
 * Points a (missing) entry at its new location, keeping pin/group/name.
 * If the new path is already in the list, the old entry is merged into it.
 */
export function locate(data: RecentsData, oldPath: string, newPath: string, key: KeyFn): RecentsData {
  const i = indexOf(data, oldPath, key)
  if (i < 0) return data
  const old = data.repos[i]!
  const without = data.repos.filter((_, n) => n !== i)
  const j = without.findIndex((r) => key(r.path) === key(newPath))
  if (j >= 0) {
    const target = without[j]!
    without[j] = {
      ...target,
      pinned: target.pinned || old.pinned,
      groupId: target.groupId ?? old.groupId,
      displayName: target.displayName ?? old.displayName
    }
    return { ...data, repos: without }
  }
  return { ...data, repos: [...without.slice(0, i), { ...old, path: newPath }, ...without.slice(i)] }
}

export function removeMissing(data: RecentsData, exists: (path: string) => boolean): RecentsData {
  return { ...data, repos: data.repos.filter((r) => exists(r.path)) }
}

/** "Clear Recent": drops non-pinned, ungrouped entries; curated ones stay. */
export function clearRecent(data: RecentsData): RecentsData {
  return { ...data, repos: data.repos.filter((r) => r.pinned || r.groupId !== null) }
}

export function createGroup(data: RecentsData, id: string, name: string): RecentsData {
  return { ...data, groups: [...data.groups, { id, name: name.trim() || 'New Group', collapsed: false }] }
}

export function renameGroup(data: RecentsData, id: string, name: string): RecentsData {
  const trimmed = name.trim()
  if (!trimmed) return data
  return { ...data, groups: data.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)) }
}

export function setGroupCollapsed(data: RecentsData, id: string, collapsed: boolean): RecentsData {
  return { ...data, groups: data.groups.map((g) => (g.id === id ? { ...g, collapsed } : g)) }
}

/** Deleting a group keeps its repos (they fall back to the ungrouped list). */
export function deleteGroup(data: RecentsData, id: string): RecentsData {
  return prune({
    groups: data.groups.filter((g) => g.id !== id),
    repos: data.repos.map((r) => (r.groupId === id ? { ...r, groupId: null } : r))
  })
}

/** Most recent first; used for menus and the quick switcher. */
export function byRecency(repos: readonly RecentRepo[]): RecentRepo[] {
  return [...repos].sort((a, b) => b.lastOpened - a.lastOpened)
}

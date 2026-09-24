import { create } from 'zustand'
import type { SessionState } from '@shared/types'
import { baseName } from '@shared/display'
import { api } from '@/lib/api'
import { newId } from '@/lib/utils'

export interface RepoTab {
  id: string
  /** Normalised repo root (from main). */
  path: string
  name: string
  /** Per-tab UI state (selected commit, filters, scroll, pane sizes). Persisted. */
  ui: Record<string, unknown>
}

/**
 * - 'replace': open in the active tab (repo switcher click)
 * - 'new-tab': open in a new tab and focus it
 * - 'background': open in a new tab, keep the current view (Ctrl/middle click)
 */
export type OpenMode = 'replace' | 'new-tab' | 'background'

interface TabsState {
  tabs: RepoTab[]
  /** null = the Welcome screen is showing. */
  activeId: string | null
  open(path: string, mode: OpenMode): void
  close(id: string): void
  activate(id: string | null): void
  activateIndex(index: number): void
  cycle(delta: 1 | -1): void
  showWelcome(): void
  setUi(id: string, patch: Record<string, unknown>): void
  restore(session: SessionState): void
}

function samePath(a: string, b: string): boolean {
  return window.bridge.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function watch(path: string): void {
  api.repo.watch(path).catch(() => undefined)
}
function unwatch(path: string): void {
  api.repo.unwatch(path).catch(() => undefined)
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,

  open(path, mode) {
    const { tabs, activeId } = get()
    const existing = tabs.find((t) => samePath(t.path, path))
    if (existing) {
      if (mode !== 'background') set({ activeId: existing.id })
      return
    }
    const tab: RepoTab = { id: newId(), path, name: baseName(path), ui: {} }
    watch(path)
    const activeIdx = tabs.findIndex((t) => t.id === activeId)
    if (mode === 'replace' && activeIdx >= 0) {
      const replaced = tabs[activeIdx]!
      unwatch(replaced.path)
      const next = [...tabs]
      next[activeIdx] = tab
      set({ tabs: next, activeId: tab.id })
      return
    }
    // New tabs go right after the active one, like an IDE / browser.
    const insertAt = activeIdx >= 0 ? activeIdx + 1 : tabs.length
    const next = [...tabs.slice(0, insertAt), tab, ...tabs.slice(insertAt)]
    set({ tabs: next, activeId: mode === 'background' ? activeId : tab.id })
  },

  close(id) {
    const { tabs, activeId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    unwatch(tabs[idx]!.path)
    const next = tabs.filter((t) => t.id !== id)
    let nextActive = activeId
    if (activeId === id) nextActive = (next[idx] ?? next[idx - 1])?.id ?? null
    set({ tabs: next, activeId: nextActive })
  },

  activate: (id) => set({ activeId: id }),

  activateIndex(index) {
    const { tabs } = get()
    // Ctrl+9 jumps to the last tab, as in browsers.
    const tab = index === 8 ? tabs[tabs.length - 1] : tabs[index]
    if (tab) set({ activeId: tab.id })
  },

  cycle(delta) {
    const { tabs, activeId } = get()
    if (tabs.length === 0) return
    const idx = tabs.findIndex((t) => t.id === activeId)
    const nextIdx = idx < 0 ? 0 : (idx + delta + tabs.length) % tabs.length
    set({ activeId: tabs[nextIdx]!.id })
  },

  showWelcome: () => set({ activeId: null }),

  setUi(id, patch) {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, ui: { ...t.ui, ...patch } } : t)) })
  },

  restore(session) {
    const tabs: RepoTab[] = session.tabs.map((t) => ({ id: newId(), path: t.path, name: baseName(t.path), ui: t.ui ?? {} }))
    tabs.forEach((t) => watch(t.path))
    const active = session.activePath ? tabs.find((t) => samePath(t.path, session.activePath!)) : undefined
    set({ tabs, activeId: active?.id ?? null })
  }
}))

export function toSession(state: Pick<TabsState, 'tabs' | 'activeId'>): SessionState {
  return {
    tabs: state.tabs.map((t) => ({ path: t.path, ui: t.ui })),
    activePath: state.tabs.find((t) => t.id === state.activeId)?.path ?? null
  }
}

function sameTabSet(a: RepoTab[], b: RepoTab[]): boolean {
  return a.length === b.length && a.every((t, i) => t.id === b[i]!.id)
}

/**
 * Persists the session. Opening/closing/switching tabs is saved immediately
 * (quitting right after opening a repo must not lose it); per-tab UI state
 * changes (scroll, selection) are debounced and flushed on unload.
 */
export function persistSession(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    if (timer) clearTimeout(timer)
    timer = null
    void api.session.save(toSession(useTabsStore.getState())).catch(() => undefined)
  }
  const flush = () => {
    if (timer) save()
  }
  window.addEventListener('beforeunload', flush)
  const unsubscribe = useTabsStore.subscribe((state, prev) => {
    if (state.tabs === prev.tabs && state.activeId === prev.activeId) return
    if (state.activeId !== prev.activeId || !sameTabSet(state.tabs, prev.tabs)) {
      save()
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 500)
  })
  return () => {
    window.removeEventListener('beforeunload', flush)
    unsubscribe()
  }
}

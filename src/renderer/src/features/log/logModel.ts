import { useEffect, useState, useSyncExternalStore } from 'react'
import { createGraphState, layoutGraph, type GraphRow } from '@shared/graph'
import type { Commit, LogQuery } from '@shared/types'
import { api, errorInfo } from '@/lib/api'

/** First page small (fast first paint), later pages bigger (fewer IPC round-trips). */
export const PAGE_SIZE = 2000
export const LATER_PAGE_SIZE = 10_000

/**
 * Commits of one log query, loaded page by page from a main-process log
 * session, with the graph laid out incrementally as pages arrive.
 */
export class LogModel {
  readonly commits: Commit[] = []
  readonly rows: GraphRow[] = []
  readonly index = new Map<string, number>()
  readonly children = new Map<string, string[]>()
  maxWidth = 1
  done = false
  loading = false
  error: string | null = null
  private version = 0
  private readonly graph = createGraphState()
  private session: string | null = null
  private readonly listeners = new Set<() => void>()
  private disposed = false
  private inflight: Promise<void> | null = null
  readonly firstPage: Promise<void>

  constructor(
    readonly root: string,
    readonly query: LogQuery,
    readonly withGraph: boolean
  ) {
    this.firstPage = this.loadMore()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = (): number => this.version

  private emit(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }

  loadMore(count = this.commits.length === 0 ? PAGE_SIZE : LATER_PAGE_SIZE): Promise<void> {
    if (this.inflight) return this.inflight
    if (this.done || this.disposed) return Promise.resolve()
    this.loading = true
    this.emit()
    this.inflight = (async () => {
      try {
        if (!this.session) this.session = await api.log.open(this.root, this.query)
        const page = await api.log.next(this.session, count)
        if (this.disposed) return
        const start = this.commits.length
        page.commits.forEach((c, i) => {
          this.commits.push(c)
          this.index.set(c.hash, start + i)
          for (const p of c.parents) {
            const list = this.children.get(p)
            if (list) list.push(c.hash)
            else this.children.set(p, [c.hash])
          }
        })
        if (this.withGraph) {
          for (const r of layoutGraph(this.graph, page.commits)) {
            this.rows.push(r)
            if (r.width > this.maxWidth) this.maxWidth = r.width
          }
        }
        if (page.done) {
          this.done = true
          this.session = null // main closes finished sessions itself on the next call; nothing to keep
        }
      } catch (err) {
        this.error = errorInfo(err).message
        this.done = true
      } finally {
        this.loading = false
        this.inflight = null
        this.emit()
      }
    })()
    return this.inflight
  }

  /** Loads pages until `hash` is loaded (or history ends). Returns its row or -1. */
  async loadUntil(hash: string, limit = 500_000): Promise<number> {
    while (!this.index.has(hash) && !this.done && this.commits.length < limit && !this.disposed) {
      await this.loadMore(10_000)
    }
    return this.index.get(hash) ?? -1
  }

  /** Loads everything that is left (End key). */
  async loadRest(): Promise<void> {
    while (!this.done && !this.disposed) await this.loadMore(20_000)
  }

  dispose(): void {
    this.disposed = true
    if (this.session) void api.log.close(this.session).catch(() => undefined)
    this.session = null
  }
}

const cache = new Map<string, { model: LogModel; epoch: number }>()
const MAX_CACHED = 8

function keyOf(root: string, query: LogQuery, withGraph: boolean): string {
  return JSON.stringify([root, query, withGraph])
}

function remember(key: string, model: LogModel, epoch: number): void {
  const old = cache.get(key)
  if (old && old.model !== model) old.model.dispose()
  cache.delete(key)
  cache.set(key, { model, epoch })
  while (cache.size > MAX_CACHED) {
    const [k, v] = cache.entries().next().value as [string, { model: LogModel }]
    v.model.dispose()
    cache.delete(k)
  }
}

/**
 * Returns the (cached) model for a query. When the repository changes
 * (`epoch`), a fresh model loads in the background and replaces the old one
 * once its first page is in, so the table never flashes empty.
 */
export function useLogModel(root: string, query: LogQuery, withGraph: boolean, epoch: number): LogModel {
  const key = keyOf(root, query, withGraph)
  const [model, setModel] = useState<LogModel>(() => {
    const hit = cache.get(key)
    if (hit) return hit.model
    const m = new LogModel(root, query, withGraph)
    remember(key, m, epoch)
    return m
  })

  useEffect(() => {
    const hit = cache.get(key)
    if (hit && hit.epoch === epoch) {
      setModel(hit.model)
      return
    }
    const fresh = new LogModel(root, query, withGraph)
    let cancelled = false
    if (!hit) {
      remember(key, fresh, epoch)
      setModel(fresh)
      return
    }
    void fresh.firstPage.then(() => {
      if (cancelled) return fresh.dispose()
      remember(key, fresh, epoch)
      setModel(fresh)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key covers root/query/withGraph
  }, [key, epoch])

  useSyncExternalStore(model.subscribe, model.getVersion)
  return model
}

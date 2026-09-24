import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Commit, Ref } from '@shared/types'
import { absoluteDate, formatDate, shortHash } from '@/lib/format'
import { cn, isPrimaryModifier } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { GraphCell, LANE_W, ROW_H } from './GraphCell'
import type { LogModel } from './logModel'
import { RefLabels } from './RefLabels'

export interface Selection {
  /** Selected hashes. */
  hashes: string[]
  /** Keyboard focus / range anchor. */
  focus: string | null
  anchor: string | null
}

export const EMPTY_SELECTION: Selection = { hashes: [], focus: null, anchor: null }

export interface LogTableHandle {
  scrollTo(hash: string): void
  focus(): void
}

interface Props {
  model: LogModel
  refsByHash: Map<string, Ref[]>
  headSha: string | null
  detached: boolean
  showGraph: boolean
  selection: Selection
  onSelectionChange(sel: Selection): void
  /** Context menu content for the current selection. */
  renderMenu?: (selected: Commit[]) => React.ReactNode
  onActivate?: (commit: Commit) => void
  highlight?: (c: Commit) => boolean
}

/** Virtualized commit table: graph, subject + ref labels, author, date, hash. */
export const LogTable = forwardRef<LogTableHandle, Props>(function LogTable(
  { model, refsByHash, headSha, detached, showGraph, selection, onSelectionChange, renderMenu, onActivate, highlight },
  ref
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const commits = model.commits
  const dateFormat = useAppStore((s) => s.settings.dateFormat)
  const selected = useMemo(() => new Set(selection.hashes), [selection.hashes])
  const graphWidth = showGraph ? Math.min(Math.max(model.maxWidth, 1), 24) : 0

  const virt = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 30
  })
  const items = virt.getVirtualItems()

  // Load the next page when the user scrolls near the end.
  const last = items[items.length - 1]?.index ?? 0
  useEffect(() => {
    if (!model.done && !model.loading && last > commits.length - 400) void model.loadMore()
  }, [last, commits.length, model])

  useImperativeHandle(
    ref,
    () => ({
      scrollTo(hash) {
        const i = model.index.get(hash)
        if (i !== undefined) virt.scrollToIndex(i, { align: 'center' })
      },
      focus() {
        scrollRef.current?.focus()
      }
    }),
    [model, virt]
  )

  const select = useCallback(
    (hash: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
      if (e.shiftKey && selection.anchor && model.index.has(selection.anchor)) {
        const a = model.index.get(selection.anchor)!
        const b = model.index.get(hash)!
        const [lo, hi] = a < b ? [a, b] : [b, a]
        onSelectionChange({ hashes: commits.slice(lo, hi + 1).map((c) => c.hash), focus: hash, anchor: selection.anchor })
      } else if (isPrimaryModifier(e)) {
        const next = new Set(selected)
        if (next.has(hash)) next.delete(hash)
        else next.add(hash)
        onSelectionChange({ hashes: [...next], focus: hash, anchor: hash })
      } else {
        onSelectionChange({ hashes: [hash], focus: hash, anchor: hash })
      }
    },
    [selection.anchor, model, commits, selected, onSelectionChange]
  )

  const move = (target: number, e: React.KeyboardEvent) => {
    const t = Math.max(0, Math.min(commits.length - 1, target))
    const c = commits[t]
    if (!c) return
    e.preventDefault()
    select(c.hash, { shiftKey: e.shiftKey, ctrlKey: false, metaKey: false })
    virt.scrollToIndex(t, { align: 'auto' })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = selection.focus ? (model.index.get(selection.focus) ?? -1) : -1
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_H) - 1)
    switch (e.key) {
      case 'ArrowDown':
        return move(cur + 1, e)
      case 'ArrowUp':
        return move(cur - 1, e)
      case 'PageDown':
        return move(cur + page, e)
      case 'PageUp':
        return move(cur - page, e)
      case 'Home':
        return move(0, e)
      case 'End':
        return move(commits.length - 1, e)
      case 'ArrowLeft': {
        // Go to (first) parent.
        const p = commits[cur]?.parents[0]
        const i = p ? model.index.get(p) : undefined
        if (i !== undefined) move(i, { ...e, shiftKey: false } as React.KeyboardEvent)
        return
      }
      case 'ArrowRight': {
        // Go to a child (the nearest one above).
        const h = commits[cur]?.hash
        const kids = h ? (model.children.get(h) ?? []) : []
        const idx = kids.map((k) => model.index.get(k) ?? -1).filter((i) => i >= 0)
        if (idx.length) move(Math.max(...idx), { ...e, shiftKey: false } as React.KeyboardEvent)
        return
      }
      case 'Enter': {
        const c = commits[cur]
        if (c) onActivate?.(c)
        return
      }
    }
  }

  const selectedCommits = () => selection.hashes.map((h) => commits[model.index.get(h) ?? -1]).filter((c): c is Commit => !!c)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="log-table">
      <div className="flex h-6 shrink-0 items-center border-b border-border-strong bg-panel text-xs text-muted">
        <div style={{ width: Math.max(graphWidth * LANE_W, 0) + 8 }} className="shrink-0" />
        <div className="min-w-0 flex-1 px-1">Subject</div>
        <div className="w-36 shrink-0 px-2">Author</div>
        <div className="w-32 shrink-0 px-2">Date</div>
        <div className="w-20 shrink-0 px-2">Hash</div>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => {
              const row = (e.target as HTMLElement).closest('[data-hash]')
              const hash = row?.getAttribute('data-hash')
              if (hash && !selected.has(hash)) onSelectionChange({ hashes: [hash], focus: hash, anchor: hash })
            }}
            className="relative min-h-0 flex-1 overflow-auto outline-none"
          >
            <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
              {items.map((vi) => {
                const c = commits[vi.index]!
                const row = model.rows[vi.index]
                const refs = refsByHash.get(c.hash) ?? []
                const isSel = selected.has(c.hash)
                const dim = !c.onCurrentBranch && !isSel
                const hl = highlight?.(c)
                return (
                  <div
                    key={c.hash}
                    data-hash={c.hash}
                    data-testid="log-row"
                    onMouseDown={(e) => e.button === 0 && select(c.hash, e)}
                    onDoubleClick={() => onActivate?.(c)}
                    className={cn(
                      'absolute left-0 right-0 flex cursor-default items-center text-[13px]',
                      isSel ? 'bg-selected' : 'hover:bg-hover',
                      selection.focus === c.hash && 'outline outline-1 -outline-offset-1 outline-accent/60'
                    )}
                    style={{ top: vi.start, height: ROW_H }}
                  >
                    <div style={{ width: graphWidth * LANE_W + 8 }} className="shrink-0 overflow-hidden pl-1">
                      {showGraph && row && (
                        <GraphCell row={row} width={graphWidth} isMerge={c.parents.length > 1} isHead={c.hash === headSha} />
                      )}
                    </div>
                    <div className={cn('flex min-w-0 flex-1 items-center gap-2 px-1', dim && 'opacity-55')}>
                      <span className={cn('truncate', hl && 'rounded bg-warning/25')}>{c.subject}</span>
                      <span className="ml-auto" />
                      <RefLabels refs={refs} detachedHead={detached && c.hash === headSha} />
                    </div>
                    <div className={cn('w-36 shrink-0 truncate px-2 text-muted', dim && 'opacity-55')} title={`${c.authorName} <${c.authorEmail}>`}>
                      {c.authorName}
                    </div>
                    <div className={cn('w-32 shrink-0 truncate px-2 text-muted', dim && 'opacity-55')} title={absoluteDate(c.authorTime)}>
                      {formatDate(c.authorTime, dateFormat)}
                    </div>
                    <div className="w-20 shrink-0 px-2 font-mono text-xs text-muted">{shortHash(c.hash)}</div>
                  </div>
                )
              })}
            </div>
            {commits.length === 0 && !model.loading && (
              <div className="p-6 text-center text-muted">{model.error ?? 'No commits match.'}</div>
            )}
            {model.loading && commits.length === 0 && <div className="p-6 text-center text-muted">Loading history…</div>}
          </div>
        </ContextMenuTrigger>
        {renderMenu && selection.hashes.length > 0 && <ContextMenuContent className="min-w-60">{renderMenu(selectedCommits())}</ContextMenuContent>}
      </ContextMenu>
      <div className="flex h-5 shrink-0 items-center gap-2 border-t border-border-strong bg-panel px-2 text-[11px] text-muted">
        <span>
          {commits.length.toLocaleString()} commit{commits.length === 1 ? '' : 's'}
          {model.done ? '' : '+'}
        </span>
        {model.loading && <span>loading…</span>}
        {model.error && <span className="text-danger">{model.error}</span>}
        {selection.hashes.length > 1 && <span>{selection.hashes.length} selected</span>}
      </div>
    </div>
  )
})

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { api } from '@/lib/api'
import { absoluteDate, formatDate, shortHash } from '@/lib/format'
import { showInLog } from '@/lib/views'
import { useEpoch } from '@/stores/repoEpoch'
import type { TabRef } from '@/stores/tabs'

const ROW = 18

/** Annotate: author/date/hash gutter coloured by age; click opens the commit in the Log. */
export function BlameView({ tab, path, rev }: { tab: TabRef; path: string; rev: string | null }) {
  const root = tab.path
  const epoch = useEpoch(root)
  const q = useQuery({ queryKey: ['repo', root, 'blame', path, rev, rev ? 0 : epoch], queryFn: () => api.history.blame(root, path, rev) })
  const lines = useMemo(() => q.data ?? [], [q.data])
  const scrollRef = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({ count: lines.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 40 })

  // Age colour: newest = accent-ish green, oldest = grey.
  const [minT, maxT] = useMemo(() => {
    const ts = lines.filter((l) => !/^0+$/.test(l.hash)).map((l) => l.authorTime)
    return ts.length ? [Math.min(...ts), Math.max(...ts)] : [0, 1]
  }, [lines])
  const ageColor = (t: number, uncommitted: boolean) => {
    if (uncommitted) return 'color-mix(in srgb, var(--warning) 30%, transparent)'
    const f = maxT === minT ? 1 : (t - minT) / (maxT - minT)
    return `color-mix(in srgb, var(--success) ${Math.round(8 + f * 30)}%, transparent)`
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="blame-view">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-strong bg-panel px-2 text-xs">
        <span className="font-semibold">Annotate {path}</span>
        <span className="text-muted">{rev ? `at ${shortHash(rev)}` : 'working tree'} · click a revision to show it in the Log</span>
      </div>
      {q.isError && <div className="p-3 text-danger">{q.error.message}</div>}
      {q.isLoading && <div className="p-3 text-muted">Loading…</div>}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto font-mono text-[12px]">
        <div style={{ height: virt.getTotalSize(), position: 'relative', minWidth: 'max-content' }}>
          {virt.getVirtualItems().map((vi) => {
            const l = lines[vi.index]!
            const uncommitted = /^0+$/.test(l.hash)
            const first = vi.index === 0 || lines[vi.index - 1]!.hash !== l.hash
            return (
              <div key={vi.index} className="absolute left-0 flex w-full" style={{ top: vi.start, height: ROW }}>
                <button
                  className="flex w-80 shrink-0 items-center gap-2 px-2 text-left font-sans text-[11px] hover:underline disabled:no-underline"
                  style={{ background: ageColor(l.authorTime, uncommitted) }}
                  disabled={uncommitted}
                  title={uncommitted ? 'Not committed yet' : `${l.hash}\n${l.author}, ${absoluteDate(l.authorTime)}\n${l.summary}`}
                  onClick={() => showInLog(l.hash)}
                >
                  {first && (
                    <>
                      <span className="w-16 shrink-0 font-mono">{uncommitted ? 'local' : shortHash(l.hash)}</span>
                      <span className="w-24 shrink-0 truncate">{l.author}</span>
                      <span className="truncate text-muted">{uncommitted ? '' : formatDate(l.authorTime)}</span>
                    </>
                  )}
                </button>
                <span className="w-12 shrink-0 select-none pr-2 text-right text-muted">{l.line}</span>
                <span className="selectable whitespace-pre pr-4">{l.text}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import type { CommandLogEntry } from '@shared/types'
import { baseName, formatCommand } from '@shared/display'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { create } from 'zustand'

const MAX_SHOWN = 1000

interface ConsoleState {
  entries: CommandLogEntry[]
  upsert(e: CommandLogEntry): void
  set(entries: CommandLogEntry[]): void
}

/** Console entries live in a store so logging continues while the panel is hidden. */
export const useConsoleStore = create<ConsoleState>((set, get) => ({
  entries: [],
  upsert(e) {
    const entries = get().entries
    const idx = entries.findLastIndex((x) => x.id === e.id)
    if (idx >= 0) {
      const next = [...entries]
      next[idx] = e
      set({ entries: next })
    } else {
      const next = entries.length >= 2000 ? entries.slice(-1999) : [...entries]
      next.push(e)
      set({ entries: next })
    }
  },
  set: (entries) => set({ entries })
}))

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false })
}

/** Memoized: a new command must not re-render the up to 1,000 entries already shown. */
const Entry = memo(function Entry({ e }: { e: CommandLogEntry }) {
  const failed = !e.running && (e.cancelled || e.exitCode !== 0)
  const [open, setOpen] = useState(false)
  const hasStderr = e.stderr.trim() !== ''
  return (
    <div className="border-b border-border px-2 py-0.5 font-mono text-[12px]">
      <div className={cn('flex items-baseline gap-2', hasStderr && 'cursor-pointer')} onClick={() => hasStderr && setOpen((o) => !o)}>
        <span className="shrink-0 text-muted">{time(e.startedAt)}</span>
        {e.cwd && <span className="shrink-0 text-muted">[{baseName(e.cwd)}]</span>}
        <span className={cn('selectable min-w-0 flex-1 break-all', failed && 'text-danger')}>{formatCommand(e.args)}</span>
        <span className="shrink-0 text-muted">
          {e.running ? 'running…' : e.cancelled ? 'cancelled' : `${e.durationMs} ms · exit ${e.exitCode ?? '?'}`}
        </span>
        {hasStderr && <span className="shrink-0 text-muted">{open ? '▾' : '▸'}</span>}
      </div>
      {open && <pre className="selectable ml-16 whitespace-pre-wrap break-all text-muted">{e.stderr}</pre>}
    </div>
  )
})

/** Console tab: every git command, its duration, exit code and stderr. */
export function GitConsole() {
  const entries = useConsoleStore((s) => s.entries)
  const setEntries = useConsoleStore((s) => s.set)
  const height = useAppStore((s) => s.settings.consoleHeight)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const activePath = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeId)?.path ?? null)
  const [onlyCurrent, setOnlyCurrent] = useState(false)
  const [showBackground, setShowBackground] = useState(false)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const shown = useMemo(() => {
    let list = onlyCurrent && activePath ? entries.filter((e) => e.cwd === activePath) : entries
    if (!showBackground) list = list.filter((e) => !e.background || (!e.running && e.exitCode !== 0))
    return list.slice(-MAX_SHOWN)
  }, [entries, onlyCurrent, activePath, showBackground])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown])

  const startResize = (ev: React.MouseEvent) => {
    ev.preventDefault()
    const startY = ev.clientY
    const startH = height
    let latest = startH
    const move = (e: MouseEvent) => {
      latest = Math.max(80, Math.min(window.innerHeight - 150, startH + (startY - e.clientY)))
      setDragHeight(latest)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDragHeight(null)
      void updateSettings({ consoleHeight: Math.round(latest) })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-border-strong bg-bg" style={{ height: dragHeight ?? height }} data-testid="git-console">
      <div className="h-1 shrink-0 cursor-row-resize hover:bg-accent" onMouseDown={startResize} />
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-strong bg-panel px-2 text-xs">
        <span className="font-semibold">Git Console</span>
        <label className="flex items-center gap-1 text-muted">
          <input type="checkbox" checked={onlyCurrent} onChange={(e) => setOnlyCurrent(e.target.checked)} />
          Current repository only
        </label>
        <label className="flex items-center gap-1 text-muted" title="Automatic status refreshes (failures are always shown)">
          <input type="checkbox" checked={showBackground} onChange={(e) => setShowBackground(e.target.checked)} />
          Show background refreshes
        </label>
        <button
          className="ml-auto rounded p-1 text-muted hover:bg-hover hover:text-fg"
          title="Clear"
          onClick={() => void api.console.clear().then(() => setEntries([]))}
        >
          <Trash2 className="size-3.5" />
        </button>
        <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" title="Hide (Alt+9)" onClick={() => void updateSettings({ showConsole: false })}>
          <X className="size-3.5" />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20
        }}
      >
        {shown.length === 0 && <div className="p-2 text-xs text-muted">No git commands yet.</div>}
        {shown.map((e) => (
          <Entry key={e.id} e={e} />
        ))}
      </div>
    </div>
  )
}

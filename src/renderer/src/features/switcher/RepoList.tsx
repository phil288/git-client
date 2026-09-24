import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { fuzzyFilter } from '@shared/fuzzy'
import { shortenHome } from '@shared/display'
import type { RecentRepoView } from '@shared/types'
import { cn, isPrimaryModifier } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { Input } from '@/components/ui/input'
import { RepoAvatar } from '../welcome/RepoAvatar'
import { displayNameOf } from '../welcome/RecentItem'
import { useRecents } from '../welcome/WelcomeScreen'

/**
 * Searchable, keyboard-driven list of recent repositories, shared by the
 * title-bar repo switcher and the Ctrl+E / Ctrl+Shift+O quick switcher.
 */
export function RepoList({
  onPick,
  currentPath,
  autoFocus = true
}: {
  onPick: (repo: RecentRepoView, e: { ctrlKey: boolean; metaKey: boolean }) => void
  currentPath?: string | null
  autoFocus?: boolean
}) {
  const info = useAppStore((s) => s.info)
  const recents = useRecents()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    const all = (recents.data?.repos ?? []).filter((r) => r.exists)
    // Pinned first, then most recent; fuzzy search keeps that order for ties.
    const ordered = [...all].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpened - a.lastOpened)
    return fuzzyFilter(ordered, query, (r) => [displayNameOf(r), r.path])
  }, [recents.data, query])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  return (
    <div className="flex min-h-0 flex-col">
      <div className="p-2">
        <Input
          autoFocus={autoFocus}
          data-testid="switcher-search"
          placeholder="Search recent repositories"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(items.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const r = items[index]
              if (r) onPick(r, e)
            }
          }}
        />
      </div>
      <div ref={listRef} className="max-h-[50vh] min-h-0 overflow-y-auto px-1 pb-1">
        {items.length === 0 && <div className="px-3 py-2 text-muted">No matching repositories</div>}
        {items.map((r, i) => (
          <div
            key={r.path}
            data-index={i}
            data-testid="switcher-item"
            onMouseMove={() => setIndex(i)}
            onClick={(e) => onPick(r, e)}
            onAuxClick={(e) => e.button === 1 && onPick(r, { ctrlKey: true, metaKey: true })}
            className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1', i === index && 'bg-accent text-accent-fg')}
          >
            <RepoAvatar name={displayNameOf(r)} size={22} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn('truncate', currentPath === r.path && 'font-semibold')}>{displayNameOf(r)}</span>
                {r.lastBranch && (
                  <span className={cn('flex items-center gap-0.5 truncate text-xs', i === index ? 'opacity-80' : 'text-muted')}>
                    <GitBranch className="size-3" />
                    {r.lastBranch}
                  </span>
                )}
              </div>
              <div className={cn('truncate text-xs', i === index ? 'opacity-80' : 'text-muted')}>
                {info ? shortenHome(r.path, info.homeDir, info.platform) : r.path}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border-strong px-3 py-1 text-[11px] text-muted">
        Enter to open · {isPrimaryModifier({ ctrlKey: true, metaKey: false }) ? 'Ctrl' : '⌘'}+click or middle-click for a new tab
      </div>
    </div>
  )
}

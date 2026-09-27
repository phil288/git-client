import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Cloud, FolderTree, GitBranch, Plus } from 'lucide-react'
import { fuzzyFilter } from '@shared/fuzzy'
import type { Ref } from '@shared/types'
import { api } from '@/lib/api'
import { checkoutFlow, refToTarget } from '@/lib/gitOps'
import { openRepoPath } from '@/lib/repoActions'
import { cn } from '@/lib/utils'
import { openModal } from '@/stores/modals'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { useWorktrees } from '../worktrees/WorktreeDialogs'

type Item = { kind: 'new' } | { kind: 'ref'; ref: Ref }

/** Compact branch switcher (current branch + searchable checkout popup) for tool-window toolbars. */
export function BranchPicker({ root }: { root: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const info = useQuery({ queryKey: ['repo', root, 'info'], queryFn: () => api.repo.info(root) })
  const refs = useQuery({ queryKey: ['repo', root, 'refs'], queryFn: () => api.repo.refs(root), staleTime: 10_000 })

  const worktrees = useWorktrees(root)

  const current = info.data?.branch ?? null
  const label = info.data ? (info.data.detached ? (info.data.headSha?.slice(0, 8) ?? 'HEAD') : current) : null
  // Local branches checked out in another worktree: git refuses to check them out here, so picking one opens its worktree.
  const worktreeOf = useMemo(
    () => new Map((worktrees.data ?? []).filter((w) => w.branch && w.branch !== current).map((w) => [w.branch!, w])),
    [worktrees.data, current]
  )

  const items = useMemo<Item[]>(() => {
    const all = refs.data ?? []
    const locals = all.filter((r) => r.kind === 'local').sort((a, b) => Number(b.isHead) - Number(a.isHead) || b.date - a.date)
    // Remote branches already tracked by a local branch are reachable through that local one.
    const tracked = new Set(locals.map((r) => r.upstream).filter(Boolean))
    const remotes = all.filter((r) => r.kind === 'remote' && !tracked.has(r.short)).sort((a, b) => b.date - a.date)
    const refItems: Item[] = fuzzyFilter([...locals, ...remotes], query, (r) => [r.short]).map((ref) => ({ kind: 'ref', ref }))
    return query.trim() ? refItems : [{ kind: 'new' }, ...refItems]
  }, [refs.data, query])

  useEffect(() => setIndex(0), [query, open])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const pick = (item: Item | undefined) => {
    if (!item) return
    setOpen(false)
    setQuery('')
    if (item.kind === 'new') openModal({ kind: 'newBranch', root, start: 'HEAD', startLabel: label ?? 'HEAD' })
    else if (item.ref.kind === 'local' && item.ref.isHead) return
    else {
      const wt = item.ref.kind === 'local' ? worktreeOf.get(item.ref.short) : undefined
      if (wt) void openRepoPath(wt.path, 'new-tab')
      else void checkoutFlow(root, refToTarget(item.ref))
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg"
          title="Switch branch"
          data-testid="branch-picker"
        >
          <GitBranch className="size-3.5 shrink-0" />
          <span className="truncate">{label ?? '…'}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="p-2">
          <Input
            autoFocus
            data-testid="branch-picker-search"
            placeholder="Search branches"
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
                pick(items[index])
              }
            }}
          />
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto px-1 pb-1">
          {refs.isLoading && <div className="px-3 py-2 text-muted">Loading…</div>}
          {refs.data && items.length === 0 && <div className="px-3 py-2 text-muted">No matching branches</div>}
          {items.map((item, i) => {
            const isRemote = item.kind === 'ref' && item.ref.kind === 'remote'
            const isHead = item.kind === 'ref' && item.ref.kind === 'local' && item.ref.isHead
            const wt = item.kind === 'ref' && item.ref.kind === 'local' ? worktreeOf.get(item.ref.short) : undefined
            const prev = items[i - 1]
            const firstRemote = isRemote && !(prev?.kind === 'ref' && prev.ref.kind === 'remote')
            return (
              <div key={item.kind === 'new' ? '__new' : item.ref.name}>
                {firstRemote && <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase text-muted">Remote</div>}
                <div
                  data-index={i}
                  data-testid={item.kind === 'new' ? 'branch-picker-new' : 'branch-picker-item'}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => pick(item)}
                  title={wt ? `Checked out in worktree ${wt.path}${wt.isMain ? ' (main)' : ''}${wt.prunable ? ' (missing, prunable)' : ''}\nClick to open it` : undefined}
                  className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px]', i === index && 'bg-accent text-accent-fg')}
                >
                  {item.kind === 'new' ? (
                    <>
                      <Plus className="size-3.5 shrink-0" /> New Branch…
                    </>
                  ) : (
                    <>
                      {isHead ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : isRemote ? (
                        <Cloud className="size-3.5 shrink-0 opacity-70" />
                      ) : wt ? (
                        <FolderTree className={cn('size-3.5 shrink-0', wt.prunable ? 'text-danger' : 'opacity-70')} data-testid="branch-picker-worktree" />
                      ) : (
                        <GitBranch className="size-3.5 shrink-0 opacity-70" />
                      )}
                      <span className={cn('truncate', isHead && 'font-semibold')}>{item.ref.short}</span>
                      {(item.ref.ahead > 0 || item.ref.behind > 0) && (
                        <span className="ml-auto shrink-0 text-[11px] opacity-70">
                          {item.ref.ahead > 0 && `↑${item.ref.ahead}`} {item.ref.behind > 0 && `↓${item.ref.behind}`}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

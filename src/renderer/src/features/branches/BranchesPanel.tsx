import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Cloud, CloudOff, Download, Folder, FolderTree, GitBranch, Plus, Search, Star, Tag } from 'lucide-react'
import { fuzzyFilter } from '@shared/fuzzy'
import type { LogQuery, Ref } from '@shared/types'
import { api } from '@/lib/api'
import { checkoutFlow, deleteBranchesFlow, fetchFlow, refToTarget } from '@/lib/gitOps'
import { run } from '@/lib/notify'
import { openRepoPath } from '@/lib/repoActions'
import { cn, isPrimaryModifier } from '@/lib/utils'
import { useTabUi } from '@/hooks/useTabUi'
import { openModal } from '@/stores/modals'
import type { TabRef } from '@/stores/tabs'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { useWorktrees } from '../worktrees/WorktreeDialogs'
import { BranchMenu } from './BranchMenu'

interface TreeNode {
  name: string
  key: string
  children: Map<string, TreeNode>
  refs: { ref: Ref; label: string }[]
}

function buildTree(refs: Ref[], prefix: string, labelOf: (r: Ref) => string): TreeNode {
  const root: TreeNode = { name: '', key: prefix, children: new Map(), refs: [] }
  for (const r of refs) {
    const parts = labelOf(r).split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!
      let next = node.children.get(name)
      if (!next) {
        next = { name, key: `${node.key}/${name}`, children: new Map(), refs: [] }
        node.children.set(name, next)
      }
      node = next
    }
    node.refs.push({ ref: r, label: parts[parts.length - 1]! })
  }
  return root
}

export function usePrefs(root: string) {
  return useQuery({ queryKey: ['prefs', root], queryFn: () => api.prefs.get(root), staleTime: Infinity })
}

interface Props {
  tab: TabRef
  refs: Ref[]
  currentBranch: string | null
  query: LogQuery
  setQuery(q: LogQuery): void
}

/** JetBrains-style branches tree: favorites, recent, local, remotes, tags. */
export function BranchesPanel({ tab, refs, currentBranch, query, setQuery }: Props) {
  const root = tab.path
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [collapsedList, setCollapsed] = useTabUi<string[]>(tab.id, 'branchesCollapsed', ['tags'])
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList])
  const prefs = usePrefs(root)
  const recent = useQuery({ queryKey: ['repo', root, 'recentBranches'], queryFn: () => api.branch.recent(root) })
  const favorites = useMemo(() => new Set(prefs.data?.favorites ?? []), [prefs.data])
  const worktrees = useWorktrees(root)
  // Local branches checked out in another worktree (this tab's own branch is already shown in bold).
  const worktreeOf = useMemo(
    () => new Map((worktrees.data ?? []).filter((w) => w.branch && w.branch !== currentBranch).map((w) => [w.branch!, w])),
    [worktrees.data, currentBranch]
  )
  // Multi-selection (Ctrl/Cmd+click toggles, Shift+click selects a range) for bulk deletion.
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const order = useRef<string[]>([])
  order.current = []
  const refByName = useMemo(() => new Map(refs.map((r) => [r.name, r])), [refs])

  const deletable = (names: Iterable<string>) => {
    const locals: string[] = []
    const remotes: { remote: string; branch: string }[] = []
    for (const n of names) {
      const r = refByName.get(n)
      if (!r) continue
      if (r.kind === 'local' && r.short !== currentBranch) locals.push(r.short)
      else if (r.kind === 'remote' && r.remote) remotes.push({ remote: r.remote, branch: r.short.slice(r.remote.length + 1) })
    }
    return { locals, remotes }
  }
  const deleteSelected = () => {
    const d = deletable(sel)
    void deleteBranchesFlow(root, d.locals, d.remotes).then(() => setSel(new Set()))
  }
  const onRowClick = (r: Ref, e: React.MouseEvent) => {
    if (isPrimaryModifier(e)) {
      const next = new Set(sel)
      if (next.has(r.name)) next.delete(r.name)
      else next.add(r.name)
      setSel(next)
      setAnchor(r.name)
      return
    }
    if (e.shiftKey && anchor) {
      const a = order.current.indexOf(anchor)
      const b = order.current.indexOf(r.name)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSel(new Set(order.current.slice(lo, hi + 1)))
        return
      }
    }
    setSel(new Set([r.name]))
    setAnchor(r.name)
    const filtered = query.revs.includes(r.name)
    setQuery({ ...query, revs: filtered ? [] : [r.name] })
  }

  const toggle = (key: string) => setCollapsed(collapsed.has(key) ? collapsedList.filter((k) => k !== key) : [...collapsedList, key])
  const toggleFavorite = (r: Ref) =>
    run(async () => {
      const next = favorites.has(r.name) ? [...favorites].filter((f) => f !== r.name) : [...favorites, r.name]
      qc.setQueryData(['prefs', root], await api.prefs.update(root, { favorites: next }))
    })

  const locals = refs.filter((r) => r.kind === 'local')
  const remotes = refs.filter((r) => r.kind === 'remote')
  const tags = refs.filter((r) => r.kind === 'tag').sort((a, b) => b.date - a.date)
  const remoteNames = [...new Set(remotes.map((r) => r.remote ?? ''))].sort()
  const byName = new Map(locals.map((r) => [r.short, r]))
  const recentRefs = (recent.data ?? []).filter((n) => n !== currentBranch).map((n) => byName.get(n)).filter((r): r is Ref => !!r).slice(0, 5)
  const favRefs = refs.filter((r) => favorites.has(r.name))

  const row = (r: Ref, label: string, depth: number) => {
    const isCurrent = r.kind === 'local' && r.short === currentBranch
    const wt = r.kind === 'local' ? worktreeOf.get(r.short) : undefined
    const filtered = query.revs.includes(r.name)
    const selected = sel.has(r.name)
    if (!order.current.includes(r.name)) order.current.push(r.name)
    const multi = selected && sel.size > 1
    const bulk = multi ? deletable(sel) : null
    return (
      <ContextMenu key={`${r.name}:${depth}:${label}`}>
        <ContextMenuTrigger asChild>
          <div
            data-testid="branch-row"
            data-ref={r.name}
            data-selected={selected || undefined}
            className={cn(
              'group flex h-[22px] cursor-default items-center gap-1.5 pr-2 hover:bg-hover',
              (filtered || selected) && 'bg-selected hover:bg-selected',
              selected && sel.size > 1 && 'outline outline-1 -outline-offset-1 outline-accent/50'
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
            title={`${r.short}${r.upstream ? ` → ${r.upstream}` : ''}\n${r.subject}\n(Ctrl+click / Shift+click to select several)`}
            onClick={(e) => onRowClick(r, e)}
            onContextMenu={() => {
              if (!sel.has(r.name)) {
                setSel(new Set([r.name]))
                setAnchor(r.name)
              }
            }}
            onDoubleClick={() => void checkoutFlow(root, refToTarget(r))}
          >
            {r.kind === 'tag' ? (
              <Tag className="size-3.5 shrink-0 text-[var(--ref-tag)]" />
            ) : r.kind === 'remote' ? (
              <Cloud className="size-3.5 shrink-0 text-[var(--ref-remote)]" />
            ) : (
              <GitBranch className={cn('size-3.5 shrink-0', isCurrent ? 'text-accent' : 'text-[var(--ref-local)]')} />
            )}
            <span className={cn('truncate', isCurrent && 'font-semibold')}>{label}</span>
            {wt && (
              <button
                className={cn('shrink-0 rounded hover:text-fg', wt.prunable ? 'text-danger' : 'text-muted')}
                title={`Checked out in worktree ${wt.path}${wt.isMain ? ' (main)' : ''}${wt.prunable ? ' (missing, prunable)' : ''}\nClick to open it`}
                data-testid="branch-worktree"
                onClick={(e) => {
                  e.stopPropagation()
                  void openRepoPath(wt.path, 'new-tab')
                }}
              >
                <FolderTree className="size-3" />
              </button>
            )}
            {r.kind === 'local' && (r.ahead > 0 || r.behind > 0) && (
              <span className="flex shrink-0 items-center text-[11px] text-muted" title={`${r.ahead} to push, ${r.behind} to pull`}>
                {r.ahead > 0 && (
                  <span className="flex items-center text-success">
                    <ArrowUp className="size-3" />
                    {r.ahead}
                  </span>
                )}
                {r.behind > 0 && (
                  <span className="flex items-center text-warning">
                    <ArrowDown className="size-3" />
                    {r.behind}
                  </span>
                )}
              </span>
            )}
            {r.kind === 'local' && !r.upstream && (
              <span title="No upstream branch">
                <CloudOff className="size-3 shrink-0 text-muted" />
              </span>
            )}
            {r.upstreamGone && <span className="shrink-0 text-[10px] text-warning" title="Upstream deleted on the remote">gone</span>}
            <button
              className={cn('ml-auto shrink-0 rounded p-0.5', favorites.has(r.name) ? 'text-warning' : 'text-muted opacity-0 group-hover:opacity-100')}
              title={favorites.has(r.name) ? 'Remove from favorites' : 'Add to favorites'}
              onClick={(e) => {
                e.stopPropagation()
                toggleFavorite(r)
              }}
            >
              <Star className="size-3" fill={favorites.has(r.name) ? 'currentColor' : 'none'} />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-64">
          {multi && bulk ? (
            <>
              <ContextMenuItem disabled={bulk.locals.length + bulk.remotes.length === 0} onSelect={deleteSelected} data-testid="delete-selected-branches">
                Delete {bulk.locals.length + bulk.remotes.length} Selected Branch{bulk.locals.length + bulk.remotes.length === 1 ? '' : 'es'}…
              </ContextMenuItem>
              {sel.size > bulk.locals.length + bulk.remotes.length && (
                <div className="px-2 py-1 text-xs text-muted">The current branch and tags are skipped.</div>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => setSel(new Set())}>Clear Selection</ContextMenuItem>
            </>
          ) : (
            <BranchMenu root={root} r={r} currentBranch={currentBranch} favorite={favorites.has(r.name)} onToggleFavorite={() => toggleFavorite(r)} />
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  const folder = (key: string, label: React.ReactNode, depth: number, children: () => React.ReactNode, count?: number, section = false) => (
    <div key={key}>
      <div
        className={cn('flex h-[22px] cursor-default items-center gap-1 hover:bg-hover', section && 'text-xs font-semibold uppercase tracking-wide text-muted')}
        style={{ paddingLeft: 2 + depth * 14 }}
        onClick={() => toggle(key)}
      >
        {collapsed.has(key) ? <ChevronRight className="size-3.5 shrink-0 text-muted" /> : <ChevronDown className="size-3.5 shrink-0 text-muted" />}
        {!section && <Folder className="size-3.5 shrink-0 text-muted" />}
        <span className="truncate">{label}</span>
        {count !== undefined && <span className="text-[11px] font-normal text-muted">{count}</span>}
      </div>
      {!collapsed.has(key) && children()}
    </div>
  )

  const renderTree = (node: TreeNode, depth: number): React.ReactNode => (
    <>
      {[...node.children.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => folder(c.key, c.name, depth, () => renderTree(c, depth + 1)))}
      {[...node.refs].sort((a, b) => a.label.localeCompare(b.label)).map(({ ref, label }) => row(ref, label, depth))}
    </>
  )

  const results = search.trim() ? fuzzyFilter(refs, search, (r) => [r.short]).slice(0, 200) : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel text-[13px]" data-testid="branches-panel">
      <div className="flex shrink-0 items-center gap-1 border-b border-border-strong p-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <Input className="h-6 pl-7 text-xs" placeholder="Branches and tags" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="branch-search" />
        </div>
        <button
          className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
          title="New branch from the current HEAD"
          onClick={() => openModal({ kind: 'newBranch', root, start: 'HEAD', startLabel: currentBranch ?? 'HEAD' })}
        >
          <Plus className="size-3.5" />
        </button>
        <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" title="Fetch all remotes" onClick={() => void fetchFlow(root)}>
          <Download className="size-3.5" />
        </button>
      </div>
      {sel.size > 1 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-strong bg-selected/40 px-2 py-1 text-xs">
          {sel.size} selected
          <button className="ml-auto text-danger hover:underline" onClick={deleteSelected} data-testid="delete-selected-bar">
            Delete…
          </button>
          <button className="text-muted hover:underline" onClick={() => setSel(new Set())}>
            Clear
          </button>
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size > 0) {
            e.preventDefault()
            deleteSelected()
          } else if (e.key === 'Escape') setSel(new Set())
        }}
      >
        {results ? (
          results.length === 0 ? (
            <div className="p-3 text-muted">No match</div>
          ) : (
            results.map((r) => row(r, r.short, 0))
          )
        ) : (
          <>
            <div
              className={cn('flex h-[22px] cursor-default items-center gap-1.5 px-2 hover:bg-hover', query.revs.length === 0 && 'bg-selected hover:bg-selected')}
              onClick={() => setQuery({ ...query, revs: [] })}
            >
              <GitBranch className="size-3.5 text-muted" /> All branches
            </div>
            {favRefs.length > 0 && folder('favorites', 'Favorites', 0, () => favRefs.map((r) => row(r, r.short, 1)), favRefs.length, true)}
            {recentRefs.length > 0 && folder('recent', 'Recent', 0, () => recentRefs.map((r) => row(r, r.short, 1)), recentRefs.length, true)}
            {folder('local', 'Local', 0, () => renderTree(buildTree(locals, 'local', (r) => r.short), 1), locals.length, true)}
            {remoteNames.length > 0 &&
              folder(
                'remote',
                'Remote',
                0,
                () =>
                  remoteNames.map((rn) =>
                    folder(`remote/${rn}`, rn, 1, () =>
                      renderTree(
                        buildTree(
                          remotes.filter((r) => r.remote === rn),
                          `remote/${rn}`,
                          (r) => r.short.slice(rn.length + 1)
                        ),
                        2
                      )
                    )
                  ),
                remotes.length,
                true
              )}
            {tags.length > 0 && folder('tags', 'Tags', 0, () => renderTree(buildTree(tags, 'tags', (r) => r.short), 1), tags.length, true)}
          </>
        )}
      </div>
    </div>
  )
}

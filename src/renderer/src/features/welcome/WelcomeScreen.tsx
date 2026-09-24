import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Download, FolderOpen, FolderPlus, FolderTree, Plus, Search, Trash2 } from 'lucide-react'
import { fuzzyFilter } from '@shared/fuzzy'
import type { RecentRepoView, RepoGroup } from '@shared/types'
import { api } from '@/lib/api'
import { run } from '@/lib/notify'
import { newRepositoryFlow, openFolderFlow, openRepoPath } from '@/lib/repoActions'
import { cn, isPrimaryModifier } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { confirm, prompt } from '@/stores/dialogs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { createGroupAndMove, displayNameOf, RecentItem, REPO_DRAG_MIME } from './RecentItem'

export function useRecents() {
  return useQuery({ queryKey: ['recents'], queryFn: () => api.recents.list(), staleTime: Infinity })
}

const byRecent = (a: RecentRepoView, b: RecentRepoView) => b.lastOpened - a.lastOpened

type DropTarget = { kind: 'pinned' } | { kind: 'group'; groupId: string | null }

function useDropZone(target: DropTarget) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(REPO_DRAG_MIME)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      },
      onDrop: (e: React.DragEvent) => {
        const path = e.dataTransfer.getData(REPO_DRAG_MIME)
        setOver(false)
        if (!path) return
        e.preventDefault()
        e.stopPropagation()
        if (target.kind === 'pinned') run(() => api.recents.setPinned(path, true))
        else
          run(async () => {
            await api.recents.moveToGroup(path, target.groupId)
            // Dragging out of "Pinned" into a section also unpins, so the entry lands where it was dropped.
            await api.recents.setPinned(path, false)
          })
      }
    }
  }
}

function Section({
  title,
  count,
  target,
  collapsed,
  onToggle,
  group,
  children
}: {
  title: string
  count: number
  target: DropTarget
  collapsed?: boolean
  onToggle?: () => void
  group?: RepoGroup
  children: React.ReactNode
}) {
  const drop = useDropZone(target)
  const header = (
    <button
      className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-muted hover:text-fg"
      onClick={onToggle}
      disabled={!onToggle}
    >
      {onToggle && (collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />)}
      <span>{title}</span>
      <span className="font-normal">({count})</span>
    </button>
  )
  return (
    <div {...drop.props} className={cn('rounded-md py-0.5', drop.over && 'bg-selected/50 ring-1 ring-accent')}>
      {group ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() =>
                run(async () => {
                  const name = await prompt({ title: 'Rename Group', initial: group.name, confirmLabel: 'Rename' })
                  if (name?.trim()) await api.groups.rename(group.id, name)
                })
              }
            >
              Rename Group…
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                run(async () => {
                  const ok = await confirm({
                    title: 'Delete Group',
                    message: `Delete the group “${group.name}”? Its repositories stay in the Recent list.`,
                    confirmLabel: 'Delete Group',
                    destructive: true
                  })
                  if (ok) await api.groups.delete(group.id)
                })
              }
            >
              Delete Group…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        header
      )}
      {!collapsed && <div>{children}</div>}
      {!collapsed && count === 0 && <div className="px-3 py-1 text-xs text-muted">Drag repositories here</div>}
    </div>
  )
}

function ActionButton({ icon, label, onClick, testId }: { icon: React.ReactNode; label: string; onClick: () => void; testId?: string }) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13px] hover:bg-hover [&_svg]:size-5 [&_svg]:text-accent"
    >
      {icon}
      {label}
    </button>
  )
}

export function WelcomeScreen() {
  const info = useAppStore((s) => s.info)
  const openDialog = useAppStore((s) => s.openDialog)
  const recents = useRecents()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Typing anywhere on the welcome screen goes to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const repos = useMemo(() => recents.data?.repos ?? [], [recents.data])
  const groups = useMemo(() => recents.data?.groups ?? [], [recents.data])
  const missingCount = repos.filter((r) => !r.exists).length

  const searchResults = useMemo(
    () => (query.trim() ? fuzzyFilter([...repos].sort(byRecent), query, (r) => [displayNameOf(r), r.path]) : null),
    [repos, query]
  )

  const pinned = repos.filter((r) => r.pinned).sort(byRecent)
  const ungrouped = repos.filter((r) => !r.pinned && r.groupId === null).sort(byRecent)

  return (
    <div className="flex h-full min-h-0" data-testid="welcome-screen">
      <aside className="flex w-72 shrink-0 flex-col gap-1 border-r border-border-strong bg-panel p-4">
        <div className="mb-4 px-3">
          <div className="text-lg font-semibold">GitClient</div>
          <div className="text-xs text-muted">{info ? `Version ${info.version}` : ' '}</div>
        </div>
        <ActionButton testId="action-open" icon={<FolderOpen />} label="Open Folder/Repository…" onClick={() => void openFolderFlow()} />
        <ActionButton testId="action-clone" icon={<Download />} label="Clone Repository…" onClick={() => openDialog('clone')} />
        <ActionButton testId="action-init" icon={<FolderPlus />} label="New Repository…" onClick={() => void newRepositoryFlow()} />
        <ActionButton testId="action-scan" icon={<FolderTree />} label="Scan Folder for Repositories…" onClick={() => openDialog('scan')} />
        <div className="mt-auto space-y-1 px-3 text-xs text-muted">
          <div>
            <Kbd>Ctrl+O</Kbd> open folder
          </div>
          <div>
            <Kbd>Ctrl+E</Kbd> recent repositories
          </div>
          <div>Drop a folder anywhere to open it</div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border-strong p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <Input
              ref={searchRef}
              data-testid="welcome-search"
              className="pl-7"
              placeholder="Search repositories by name or path"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
                if (e.key === 'Enter') {
                  const first = (searchResults ?? [...pinned, ...ungrouped]).find((r) => r.exists)
                  if (first) void openRepoPath(first.path, isPrimaryModifier(e) ? 'background' : 'new-tab')
                }
              }}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => run(() => createGroupAndMove(null))}>
            <Plus /> New Group
          </Button>
          {missingCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                run(async () => {
                  const ok = await confirm({
                    title: 'Remove missing repositories',
                    message: `Remove ${missingCount} repositor${missingCount === 1 ? 'y' : 'ies'} whose folder no longer exists from the list? Nothing is deleted on disk.`,
                    confirmLabel: 'Remove'
                  })
                  if (ok) await api.recents.removeMissing()
                })
              }
            >
              <Trash2 /> Remove all missing ({missingCount})
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="recent-list">
          {recents.isLoading && <div className="p-4 text-muted">Loading…</div>}
          {!recents.isLoading && repos.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
              <div className="text-sm">No recent repositories yet.</div>
              <div className="text-xs">Open, clone or scan a folder to get started.</div>
            </div>
          )}

          {searchResults ? (
            searchResults.length === 0 ? (
              <div className="p-4 text-muted">No repositories match “{query}”.</div>
            ) : (
              searchResults.map((r, i) => <RecentItem key={r.path} repo={r} groups={groups} highlighted={i === 0} />)
            )
          ) : (
            repos.length > 0 && (
              <div className="space-y-2">
                {pinned.length > 0 && (
                  <Section title="Pinned" count={pinned.length} target={{ kind: 'pinned' }}>
                    {pinned.map((r) => (
                      <RecentItem key={r.path} repo={r} groups={groups} />
                    ))}
                  </Section>
                )}
                {groups.map((g) => {
                  const items = repos.filter((r) => !r.pinned && r.groupId === g.id).sort(byRecent)
                  return (
                    <Section
                      key={g.id}
                      title={g.name}
                      count={items.length}
                      group={g}
                      target={{ kind: 'group', groupId: g.id }}
                      collapsed={g.collapsed}
                      onToggle={() => run(() => api.groups.setCollapsed(g.id, !g.collapsed))}
                    >
                      {items.map((r) => (
                        <RecentItem key={r.path} repo={r} groups={groups} />
                      ))}
                    </Section>
                  )
                })}
                <Section title="Recent" count={ungrouped.length} target={{ kind: 'group', groupId: null }}>
                  {ungrouped.map((r) => (
                    <RecentItem key={r.path} repo={r} groups={groups} />
                  ))}
                </Section>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  )
}

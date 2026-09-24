import { ArrowDown, ArrowUp, FolderSearch, GitBranch, Star, Trash2 } from 'lucide-react'
import type { RecentRepoView, RepoGroup } from '@shared/types'
import { baseName, relativeTime, shortenHome } from '@shared/display'
import { api } from '@/lib/api'
import { openRepoPath } from '@/lib/repoActions'
import { run } from '@/lib/notify'
import { cn, isPrimaryModifier } from '@/lib/utils'
import { prompt } from '@/stores/dialogs'
import { useAppStore } from '@/stores/app'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { RepoAvatar } from './RepoAvatar'
import { useQuickStatus } from './useQuickStatus'

export const REPO_DRAG_MIME = 'application/x-gitclient-repo'

export function displayNameOf(r: RecentRepoView): string {
  return r.displayName ?? baseName(r.path)
}

export async function locateRepo(r: RecentRepoView): Promise<void> {
  const picked = await api.dialog.pickFolder(`Locate “${displayNameOf(r)}”`)
  if (picked) await api.recents.locate(r.path, picked)
}

export async function createGroupAndMove(path: string | null): Promise<void> {
  const name = await prompt({ title: 'New Group', label: 'Group name', placeholder: 'e.g. Work', confirmLabel: 'Create' })
  if (!name?.trim()) return
  const group = await api.groups.create(name)
  if (path) await api.recents.moveToGroup(path, group.id)
}

interface Props {
  repo: RecentRepoView
  groups: RepoGroup[]
  highlighted?: boolean
}

export function RecentItem({ repo, groups, highlighted }: Props) {
  const info = useAppStore((s) => s.info)
  const name = displayNameOf(repo)
  const status = useQuickStatus(repo.path, repo.exists)
  const s = status.data
  const shortPath = info ? shortenHome(repo.path, info.homeDir, info.platform) : repo.path
  const branch = s?.isRepo ? (s.detached ? 'detached HEAD' : s.branch) : repo.lastBranch

  const open = (mode: 'new-tab' | 'background') => {
    if (!repo.exists) return
    void openRepoPath(repo.path, mode)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          data-testid="recent-item"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(REPO_DRAG_MIME, repo.path)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onClick={(e) => open(isPrimaryModifier(e) ? 'background' : 'new-tab')}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              open('background')
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') open(isPrimaryModifier(e) ? 'background' : 'new-tab')
          }}
          title={repo.path}
          className={cn(
            'group flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover',
            highlighted && 'bg-selected hover:bg-selected',
            !repo.exists && 'cursor-default'
          )}
        >
          <RepoAvatar name={name} dimmed={!repo.exists} />
          <div className={cn('min-w-0 flex-1', !repo.exists && 'opacity-50')}>
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{name}</span>
              {branch && (
                <span className="flex min-w-0 items-center gap-0.5 truncate text-xs text-muted">
                  <GitBranch className="size-3 shrink-0" />
                  <span className="truncate">{branch}</span>
                </span>
              )}
              {s?.dirty && (
                <span className="text-xs text-accent" title={`${s.changedCount} uncommitted change(s)`}>
                  ●
                </span>
              )}
              {s && s.ahead > 0 && (
                <span className="flex items-center text-xs text-success" title={`${s.ahead} commit(s) to push`}>
                  <ArrowUp className="size-3" />
                  {s.ahead}
                </span>
              )}
              {s && s.behind > 0 && (
                <span className="flex items-center text-xs text-warning" title={`${s.behind} commit(s) to pull`}>
                  <ArrowDown className="size-3" />
                  {s.behind}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted">{repo.exists ? shortPath : `${shortPath} — folder not found`}</div>
          </div>
          {repo.exists ? (
            <>
              <span className="shrink-0 text-xs text-muted" title={new Date(repo.lastOpened).toLocaleString()}>
                {relativeTime(repo.lastOpened)}
              </span>
              <button
                className={cn('rounded p-0.5 text-muted hover:text-fg', repo.pinned ? 'text-warning' : 'opacity-0 group-hover:opacity-100')}
                title={repo.pinned ? 'Unpin' : 'Pin to top'}
                onClick={(e) => {
                  e.stopPropagation()
                  run(() => api.recents.setPinned(repo.path, !repo.pinned))
                }}
              >
                <Star className="size-3.5" fill={repo.pinned ? 'currentColor' : 'none'} />
              </button>
            </>
          ) : (
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="secondary" onClick={(e) => (e.stopPropagation(), run(() => locateRepo(repo)))}>
                <FolderSearch /> Locate…
              </Button>
              <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), run(() => api.recents.remove([repo.path])))}>
                <Trash2 /> Remove
              </Button>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {repo.exists ? (
          <>
            <ContextMenuItem onSelect={() => open('new-tab')}>Open</ContextMenuItem>
            <ContextMenuItem onSelect={() => open('background')}>Open in New Tab</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => run(() => api.shell.openInFileManager(repo.path))}>Open in File Manager</ContextMenuItem>
            <ContextMenuItem onSelect={() => run(() => api.shell.openInTerminal(repo.path))}>Open in Terminal</ContextMenuItem>
            <ContextMenuItem onSelect={() => run(() => api.shell.openInEditor(repo.path))}>Open in Editor</ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem onSelect={() => run(() => locateRepo(repo))}>Locate…</ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => run(() => api.shell.copyText(repo.path))}>Copy Path</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() =>
            run(async () => {
              const value = await prompt({
                title: 'Rename Display Name',
                label: 'Display name (leave empty to use the folder name)',
                initial: repo.displayName ?? baseName(repo.path),
                confirmLabel: 'Rename'
              })
              if (value !== null) await api.recents.rename(repo.path, value.trim() === '' ? null : value)
            })
          }
        >
          Rename Display Name…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => run(() => api.recents.setPinned(repo.path, !repo.pinned))}>
          {repo.pinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to Group</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem disabled={repo.groupId === null} onSelect={() => run(() => api.recents.moveToGroup(repo.path, null))}>
              No Group
            </ContextMenuItem>
            {groups.map((g) => (
              <ContextMenuItem key={g.id} disabled={repo.groupId === g.id} onSelect={() => run(() => api.recents.moveToGroup(repo.path, g.id))}>
                {g.name}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => run(() => createGroupAndMove(repo.path))}>New Group…</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => run(() => api.recents.remove([repo.path]))}>Remove from Recents</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

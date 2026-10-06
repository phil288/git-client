import { toast } from 'sonner'
import { Cloud, Copy, Download, ExternalLink, FolderGit2, MoreHorizontal, Pencil, Plus, Server } from 'lucide-react'
import type { Remote } from '@shared/types'
import { PROTOCOL_LABEL, parseRemoteUrl, redactUrl } from '@shared/remotes'
import { api } from '@/lib/api'
import { fetchFlow } from '@/lib/gitOps'
import { run } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { openModal } from '@/stores/modals'
import type { TabRef } from '@/stores/tabs'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useRefs } from '../log/LogView'
import { useRepoInfo } from '../repo/RepoView'
import { pruneRemoteFlow, removeRemoteFlow, remoteUsage, switchProtocolFlow, switchProtocolTarget, testRemoteFlow, useRemotes, type RemoteUsage } from './remoteFlows'

function Badge({ children, tone = 'muted', title }: { children: React.ReactNode; tone?: 'muted' | 'accent' | 'warning'; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'shrink-0 rounded px-1 text-[10px] uppercase leading-4',
        tone === 'muted' && 'bg-hover text-muted',
        tone === 'accent' && 'bg-accent/15 text-accent',
        tone === 'warning' && 'bg-warning/15 text-warning'
      )}
    >
      {children}
    </span>
  )
}

const copy = (text: string, what: string) =>
  run(async () => {
    await api.shell.copyText(text)
    toast.success(`Copied ${what}`)
  })

interface Action {
  label: string
  onSelect: () => void
  danger?: boolean
  separator?: boolean
  testId?: string
}

function remoteActions(root: string, r: Remote, usage: RemoteUsage): Action[] {
  const p = parseRemoteUrl(r.fetchUrl)
  const sw = switchProtocolTarget(r)
  const actions: Action[] = [
    { label: 'Edit…', onSelect: () => openModal({ kind: 'remote', root, remote: r }), testId: 'remote-edit' },
    { label: `Fetch ${r.name}`, onSelect: () => void fetchFlow(root, r.name) },
    { label: 'Test Connection', onSelect: () => void testRemoteFlow(root, r), testId: 'remote-test-action' }
  ]
  if (p.webUrl) actions.push({ label: `Open on ${p.provider ?? p.host}`, onSelect: () => run(() => api.shell.openExternal(p.webUrl!)) })
  actions.push({ label: 'Copy URL', onSelect: () => copy(r.fetchUrl, 'URL'), separator: true })
  if (sw) actions.push({ label: `Switch to ${sw.label}`, onSelect: () => void switchProtocolFlow(root, r), testId: 'remote-switch' })
  actions.push(
    { label: 'Prune Stale Branches', onSelect: () => void pruneRemoteFlow(root, r), separator: true },
    { label: 'Remove…', onSelect: () => void removeRemoteFlow(root, r, usage), danger: true, separator: true, testId: 'remote-remove' }
  )
  return actions
}

function RemoteCard({ root, r, usage, currentUpstream }: { root: string; r: Remote; usage: RemoteUsage; currentUpstream: string | null }) {
  const p = parseRemoteUrl(r.fetchUrl)
  const push = r.pushUrl !== r.fetchUrl ? parseRemoteUrl(r.pushUrl) : null
  const actions = remoteActions(root, r, usage)
  const edit = () => openModal({ kind: 'remote', root, remote: r })
  const Icon = p.protocol === 'local' || p.protocol === 'file' ? FolderGit2 : p.provider ? Cloud : Server
  const insecure = p.hasPassword || p.protocol === 'http' || p.protocol === 'git'
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group flex gap-3 rounded-md border border-border-strong bg-panel p-3 hover:border-accent/60"
          onDoubleClick={edit}
          data-testid="remote-card"
          data-name={r.name}
        >
          <Icon className="mt-0.5 size-5 shrink-0 text-[var(--ref-remote)]" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[14px] font-semibold">{r.name}</span>
              {p.provider && <Badge tone="accent">{p.provider}</Badge>}
              <Badge tone={insecure ? 'warning' : 'muted'} title={insecure ? 'Unencrypted, or the URL contains a password' : undefined}>
                {PROTOCOL_LABEL[p.protocol]}
              </Badge>
              {currentUpstream && (
                <Badge tone="accent" title={`The current branch tracks ${currentUpstream}`}>
                  tracked by current branch
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted">{push ? 'fetch' : 'url'}</span>
              <span className="selectable min-w-0 truncate font-mono text-xs" title={redactUrl(r.fetchUrl)} data-testid="remote-fetch-url">
                {redactUrl(r.fetchUrl)}
              </span>
              <button className="invisible rounded p-0.5 text-muted hover:bg-hover hover:text-fg group-hover:visible" title="Copy URL" onClick={() => copy(r.fetchUrl, 'URL')}>
                <Copy className="size-3" />
              </button>
            </div>
            {push && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted">push</span>
                <span className="selectable min-w-0 truncate font-mono text-xs" title={redactUrl(r.pushUrl)} data-testid="remote-push-url">
                  {redactUrl(r.pushUrl)}
                </span>
              </div>
            )}
            <div className="text-xs text-muted">
              {usage.branches === 0 ? 'No branches fetched yet' : `${usage.branches} remote branch${usage.branches === 1 ? '' : 'es'}`}
              {usage.tracking.length > 0 && ` · tracked by ${usage.tracking.length} local branch${usage.tracking.length === 1 ? '' : 'es'}`}
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-0.5">
            <Button size="sm" variant="ghost" title={`Fetch ${r.name}`} onClick={() => void fetchFlow(root, r.name)} data-testid="remote-fetch">
              <Download /> Fetch
            </Button>
            {p.webUrl && (
              <Button size="icon-sm" variant="ghost" title={`Open on ${p.provider ?? p.host}`} onClick={() => run(() => api.shell.openExternal(p.webUrl!))}>
                <ExternalLink />
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" title="Edit…" onClick={edit} data-testid="remote-edit-button">
              <Pencil />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" title="More actions" data-testid="remote-more">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.map((a) => (
                  <div key={a.label}>
                    {a.separator && <DropdownMenuSeparator />}
                    <DropdownMenuItem className={cn(a.danger && 'text-danger')} onSelect={a.onSelect} data-testid={a.testId}>
                      {a.label}
                    </DropdownMenuItem>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((a) => (
          <div key={a.label}>
            {a.separator && <ContextMenuSeparator />}
            <ContextMenuItem className={cn(a.danger && 'text-danger')} onSelect={a.onSelect}>
              {a.label}
            </ContextMenuItem>
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Remotes of the repository as cards: what they point at, how they are used, and every action on them. */
export function RemotesView({ tab }: { tab: TabRef }) {
  const root = tab.path
  const q = useRemotes(root)
  const refs = useRefs(root).data
  const branch = useRepoInfo(root).data?.branch ?? null
  const upstream = refs?.find((r) => r.kind === 'local' && r.short === branch)?.upstream ?? null
  // origin first, the rest in git's (alphabetical) order.
  const remotes = [...(q.data ?? [])].sort((a, b) => Number(b.name === 'origin') - Number(a.name === 'origin'))

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="remotes-view">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-strong bg-panel px-2">
        <Button size="sm" variant="ghost" onClick={() => openModal({ kind: 'remote', root })} data-testid="remote-add">
          <Plus /> Add Remote…
        </Button>
        <Button size="sm" variant="ghost" disabled={remotes.length === 0} onClick={() => void fetchFlow(root)} data-testid="remote-fetch-all">
          <Download /> Fetch All
        </Button>
        <span className="ml-auto text-xs text-muted">{remotes.length > 0 && `${remotes.length} remote${remotes.length === 1 ? '' : 's'}`}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {q.isLoading && <div className="text-muted">Loading…</div>}
        {q.isError && <div className="text-danger">{q.error.message}</div>}
        {q.data && remotes.length === 0 && (
          <div className="mx-auto mt-12 flex max-w-md flex-col items-center gap-3 text-center" data-testid="remotes-empty">
            <Cloud className="size-10 text-muted" />
            <div className="text-[15px] font-semibold">No remotes yet</div>
            <div className="text-muted">
              A remote is a copy of this repository hosted somewhere else, such as GitHub, GitLab or your own server. Add one to fetch, pull and push. The main one is
              usually called <span className="font-mono">origin</span>.
            </div>
            <Button onClick={() => openModal({ kind: 'remote', root })} data-testid="remote-add-empty">
              <Plus /> Add Remote…
            </Button>
          </div>
        )}
        <div className="mx-auto flex max-w-4xl flex-col gap-2">
          {remotes.map((r) => (
            <RemoteCard
              key={r.name}
              root={root}
              r={r}
              usage={remoteUsage(refs, r.name)}
              currentUpstream={upstream?.startsWith(`${r.name}/`) ? upstream : null}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

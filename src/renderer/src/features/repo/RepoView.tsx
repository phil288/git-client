import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Archive, ExternalLink, FileClock, GitCommitHorizontal, GitCommitVertical, History, Loader2, ScrollText, X } from 'lucide-react'
import { api } from '@/lib/api'
import { openRepoPath } from '@/lib/repoActions'
import { cn } from '@/lib/utils'
import { useTabUi } from '@/hooks/useTabUi'
import type { TabRef } from '@/stores/tabs'
import { Button } from '@/components/ui/button'
import { BranchesPanel } from '../branches/BranchesPanel'
import { ChangesView, useWorkingStatus } from '../changes/ChangesView'
import { BlameView } from '../history/BlameView'
import { FileHistoryView } from '../history/FileHistoryView'
import { StashView } from '../stash/StashView'
import { CommitMenu } from '../log/CommitMenu'
import { LogView, useRefs } from '../log/LogView'
import { OperationBanner } from './OperationBanner'

export type RepoViewKind = 'log' | 'commit' | 'stash' | 'history' | 'blame'

interface StripeItem {
  id: RepoViewKind
  label: string
  icon: React.ReactNode
  shortcut?: string
}

const STRIPE: StripeItem[] = [
  { id: 'commit', label: 'Commit', icon: <GitCommitHorizontal className="size-4" />, shortcut: 'Ctrl+K' },
  { id: 'log', label: 'Git Log', icon: <History className="size-4" /> },
  { id: 'stash', label: 'Stashes', icon: <Archive className="size-4" /> }
]

export function useRepoInfo(root: string) {
  return useQuery({ queryKey: ['repo', root, 'info'], queryFn: () => api.repo.info(root) })
}

/** One repository tab: tool-window stripe on the left, the active view on the right. */
export function RepoView({ tab }: { tab: TabRef }) {
  const info = useRepoInfo(tab.path)
  const [view, setView] = useTabUi<RepoViewKind>(tab.id, 'view', 'log')
  const refs = useRefs(tab.path)
  const [historyPath, setHistoryPath] = useTabUi<string | null>(tab.id, 'historyPath', null)
  const [blamePath, setBlamePath] = useTabUi<string | null>(tab.id, 'blamePath', null)
  const [blameRev] = useTabUi<string | null>(tab.id, 'blameRev', null)
  // Poll only while the Commit view is visible; otherwise refresh on focus / repo events.
  const status = useWorkingStatus(tab.path, view === 'commit')
  const changeCount = status.data?.entries.length ?? 0

  if (info.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading {tab.name}…
      </div>
    )
  }
  if (info.isError || !info.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2" data-testid="repo-error">
        <AlertTriangle className="size-6 text-warning" />
        <div>Could not open {tab.path}</div>
        <div className="max-w-xl text-center text-xs text-muted">{info.error?.message}</div>
        <Button variant="secondary" onClick={() => void info.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const r = info.data
  return (
    <div className="flex h-full min-h-0" data-testid="repo-view">
      <nav className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-border-strong bg-panel py-1">
        {STRIPE.map((s) => (
          <button
            key={s.id}
            title={s.shortcut ? `${s.label} (${s.shortcut})` : s.label}
            onClick={() => setView(s.id)}
            className={cn('relative rounded p-1.5 text-muted hover:bg-hover hover:text-fg', view === s.id && 'bg-hover text-fg')}
            data-testid={`stripe-${s.id}`}
          >
            {s.icon}
            {s.id === 'commit' && changeCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-accent px-0.5 text-center text-[9px] leading-3.5 text-accent-fg">
                {changeCount > 99 ? '99+' : changeCount}
              </span>
            )}
          </button>
        ))}
        {historyPath && (
          <div className="group relative">
            <button
              title={`History: ${historyPath}`}
              onClick={() => setView('history')}
              className={cn('rounded p-1.5 text-muted hover:bg-hover hover:text-fg', view === 'history' && 'bg-hover text-fg')}
            >
              <FileClock className="size-4" />
            </button>
            <button
              className="absolute -right-1 -top-1 hidden rounded-full bg-panel-2 p-px group-hover:block"
              title="Close history"
              onClick={() => {
                setHistoryPath(null)
                if (view === 'history') setView('log')
              }}
            >
              <X className="size-2.5" />
            </button>
          </div>
        )}
        {blamePath && (
          <div className="group relative">
            <button
              title={`Annotate: ${blamePath}`}
              onClick={() => setView('blame')}
              className={cn('rounded p-1.5 text-muted hover:bg-hover hover:text-fg', view === 'blame' && 'bg-hover text-fg')}
            >
              <ScrollText className="size-4" />
            </button>
            <button
              className="absolute -right-1 -top-1 hidden rounded-full bg-panel-2 p-px group-hover:block"
              title="Close annotate"
              onClick={() => {
                setBlamePath(null)
                if (view === 'blame') setView('log')
              }}
            >
              <X className="size-2.5" />
            </button>
          </div>
        )}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {r.superproject && (
          <div className="flex items-center gap-2 border-b border-border-strong bg-panel px-3 py-1 text-xs">
            <GitCommitVertical className="size-3.5 text-muted" />
            Submodule of
            <button className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => void openRepoPath(r.superproject!, 'new-tab')}>
              {r.superproject} <ExternalLink className="size-3" />
            </button>
          </div>
        )}
        <OperationBanner root={tab.path} />
        <div className="min-h-0 flex-1" data-testid="repo-branch" data-branch={r.branch ?? ''}>
          {view === 'commit' && <ChangesView tab={tab} />}
          {view === 'stash' && <StashView tab={tab} />}
          {view === 'history' && historyPath && <FileHistoryView key={historyPath} tab={tab} path={historyPath} />}
          {view === 'blame' && blamePath && <BlameView key={`${blamePath}@${blameRev}`} tab={tab} path={blamePath} rev={blameRev} />}
          {view === 'log' && (
            <LogView
              tab={tab}
              headSha={r.headSha}
              detached={r.detached}
              sidebar={({ query, setQuery }) => (
                <BranchesPanel tab={tab} refs={refs.data ?? []} currentBranch={r.branch} query={query} setQuery={setQuery} />
              )}
              renderMenu={(selected, { openDiff, branchCommits }) => (
                <CommitMenu
                  root={tab.path}
                  selected={selected}
                  headSha={r.headSha}
                  currentBranch={r.branch}
                  branchCommits={branchCommits}
                  openDiff={openDiff}
                />
              )}
            />
          )}
        </div>
      </div>
    </div>
  )
}

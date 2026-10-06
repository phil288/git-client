import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Archive, GitBranchPlus, Plus } from 'lucide-react'
import type { StashEntry } from '@shared/types'
import { api } from '@/lib/api'
import { refreshRepo, reportOutcome } from '@/lib/gitOps'
import { formatDate } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useTabUi } from '@/hooks/useTabUi'
import { useEpoch } from '@/stores/repoEpoch'
import { confirm, prompt } from '@/stores/dialogs'
import { openModal } from '@/stores/modals'
import type { TabRef } from '@/stores/tabs'
import { SplitPane } from '@/components/SplitPane'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ChangesBrowser } from '../common/ChangesBrowser'

export function useStashes(root: string) {
  const epoch = useEpoch(root)
  return useQuery({ queryKey: ['repo', root, 'stashes', epoch], queryFn: () => api.stash.list(root) })
}

function StashDetails({ root, s }: { root: string; s: StashEntry }) {
  const q = useQuery({ queryKey: ['blob-stash', root, s.hash], queryFn: () => api.stash.files(root, s.index), staleTime: Infinity })
  const [showUntracked, setShowUntracked] = useState(false)
  if (!q.data) return <div className="p-3 text-muted">{q.isError ? q.error.message : 'Loading…'}</div>
  const d = q.data
  return (
    <div className="flex h-full min-h-0 flex-col">
      {d.untracked.length > 0 && (
        <div className="flex shrink-0 gap-1 border-b border-border-strong px-2 py-1 text-xs">
          <button className={cn('rounded px-2', !showUntracked && 'bg-hover')} onClick={() => setShowUntracked(false)}>
            Tracked changes ({d.files.length})
          </button>
          <button className={cn('rounded px-2', showUntracked && 'bg-hover')} onClick={() => setShowUntracked(true)}>
            Untracked files ({d.untracked.length})
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {showUntracked && d.untrackedCommit ? (
          <ChangesBrowser root={root} files={d.untracked} leftRev={d.base} rightRev={d.untrackedCommit} leftLabel="(none)" rightLabel="Stashed untracked file" />
        ) : (
          <ChangesBrowser root={root} files={d.files} leftRev={d.base} rightRev={d.hash} leftLabel={`Base ${d.base.slice(0, 8)}`} rightLabel={s.ref} />
        )}
      </div>
    </div>
  )
}

/** Stash tool window. */
export function StashView({ tab }: { tab: TabRef }) {
  const root = tab.path
  const q = useStashes(root)
  const [selected, setSelected] = useState(0)
  const [reinstate, setReinstate] = useState(false)
  const [w, setW] = useTabUi(tab.id, 'stashListWidth', 360)
  const list = q.data ?? []
  const cur = list[Math.min(selected, list.length - 1)]

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <SplitPane direction="horizontal" size={w} onSizeChange={setW} minFirst={240}>
      <div className="flex h-full min-h-0 flex-col" data-testid="stash-view">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-strong bg-panel px-2">
          <Button size="sm" variant="ghost" onClick={() => openModal({ kind: 'stashCreate', root })} data-testid="stash-create">
            <Plus /> Stash Changes…
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {list.length === 0 && <div className="p-6 text-center text-muted">{q.isLoading ? 'Loading…' : 'No stashes'}</div>}
          {list.map((s, i) => (
            <div
              key={s.hash}
              data-testid="stash-row"
              onClick={() => setSelected(i)}
              className={cn('flex cursor-default items-start gap-2 border-b border-border px-2 py-1.5', cur?.hash === s.hash ? 'bg-selected' : 'hover:bg-hover')}
            >
              <Archive className="mt-0.5 size-3.5 shrink-0 text-muted" />
              <div className="min-w-0">
                <div className="truncate">{s.message}</div>
                <div className="text-xs text-muted">
                  {s.ref} · {formatDate(s.time)}
                </div>
              </div>
            </div>
          ))}
        </div>
        {cur && (
          <div className="flex shrink-0 flex-col gap-1 border-t border-border-strong bg-panel p-2">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={reinstate} onCheckedChange={(c) => setReinstate(c === true)} /> Reinstate index (restore staged state)
            </label>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" onClick={() => void act(async () => reportOutcome(root, await api.stash.pop(root, cur.index, reinstate)))} data-testid="stash-pop">
                Pop
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void act(async () => reportOutcome(root, await api.stash.apply(root, cur.index, reinstate)))}>
                Apply
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void act(async () => {
                    const name = await prompt({ title: 'Create Branch from Stash', label: 'New branch name', confirmLabel: 'Create' })
                    if (!name?.trim()) return
                    await api.stash.branch(root, name.trim(), cur.index)
                    refreshRepo(root)
                    toast.success(`Created ${name.trim()} from ${cur.ref}`)
                  })
                }
              >
                <GitBranchPlus /> Branch…
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() =>
                  void act(async () => {
                    const ok = await confirm({ title: 'Drop stash', message: `Permanently drop ${cur.ref} “${cur.message}”?`, confirmLabel: 'Drop', destructive: true })
                    if (!ok) return
                    await api.stash.drop(root, cur.index)
                    refreshRepo(root)
                  })
                }
              >
                Drop…
              </Button>
            </div>
          </div>
        )}
      </div>
      {cur ? <StashDetails root={root} s={cur} /> : <div className="flex h-full items-center justify-center text-muted">Select a stash</div>}
    </SplitPane>
  )
}

import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from 'lucide-react'
import { fetchFlow, pullFlow } from '@/lib/gitOps'
import { openModal } from '@/stores/modals'

/** Fetch / Pull / Push for the active repository (title-bar area, like the IDE toolbar). */
export function RepoToolbar({ root }: { root: string }) {
  const btn = 'flex items-center gap-1 rounded px-2 text-xs text-muted hover:bg-hover hover:text-fg'
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-l border-border-strong px-1">
      <button className={btn} title="Fetch all remotes" onClick={() => void fetchFlow(root)} data-testid="toolbar-fetch">
        <RefreshCw className="size-3.5" /> Fetch
      </button>
      <button className={btn} title="Pull (Settings → default pull mode)" onClick={() => void pullFlow(root)} data-testid="toolbar-pull">
        <ArrowDownToLine className="size-3.5" /> Pull
      </button>
      <button className={btn} title="Push…" onClick={() => openModal({ kind: 'push', root })} data-testid="toolbar-push">
        <ArrowUpFromLine className="size-3.5" /> Push
      </button>
    </div>
  )
}

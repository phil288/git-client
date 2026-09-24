import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, RefreshCw } from 'lucide-react'
import type { Ref } from '@shared/types'
import { compareVersionNames } from '@shared/versions'
import { fetchFlow, pullFlow } from '@/lib/gitOps'
import { queryClient } from '@/lib/queryClient'
import { undoLastFlow } from '@/lib/rewriteFlows'
import { openModal } from '@/stores/modals'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** Extra entries contributed by later features (stash, remotes…). */
export const gitMenuExtras: { items: ((root: string) => React.ReactNode)[] } = { items: [] }

/** Compare dialog for HEAD against the newest tag (or HEAD itself); both sides are editable there. */
function openCompare(root: string): void {
  const refs = queryClient.getQueryData<Ref[]>(['repo', root, 'refs']) ?? []
  const tag = refs.filter((r) => r.kind === 'tag').sort((a, b) => compareVersionNames(b.short, a.short))[0]
  openModal({ kind: 'compare', root, a: 'HEAD', aLabel: 'HEAD', b: tag?.name ?? 'HEAD', bLabel: tag?.short ?? 'HEAD' })
}

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={btn} data-testid="git-menu">
            Git <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem onSelect={() => void undoLastFlow(root)}>Undo Last Operation</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openModal({ kind: 'reflog', root })}>Reflog &amp; Backups…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openCompare(root)} data-testid="git-menu-compare">
            Compare Branches &amp; Tags…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {gitMenuExtras.items.map((render, i) => (
            <span key={i}>{render(root)}</span>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

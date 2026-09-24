import { useQuery } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import type { DiffHunk } from '@shared/types'
import { api } from '@/lib/api'
import { refreshRepo } from '@/lib/gitOps'
import { run } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { confirm } from '@/stores/dialogs'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * Per-hunk staging: staged hunks (HEAD→index) are checked, unstaged hunks
 * (index→worktree) unchecked. Toggling applies the hunk with `git apply --cached`.
 */
export function HunkView({ root, path }: { root: string; path: string }) {
  const q = useQuery({ queryKey: ['repo', root, 'hunks', path], queryFn: () => api.wt.hunks(root, path) })
  const fh = q.data
  if (q.isLoading) return <div className="p-3 text-muted">Loading…</div>
  if (q.isError) return <div className="p-3 text-danger">{q.error.message}</div>
  if (!fh) return null
  if (fh.binary) return <div className="p-3 text-muted">Binary file — stage it as a whole with the checkbox in the tree.</div>
  const all = [...fh.staged, ...fh.unstaged].sort((a, b) => a.newStart - b.newStart || (a.source === 'staged' ? -1 : 1))
  if (all.length === 0) return <div className="p-3 text-muted">No text changes (new untracked file, mode change or empty file). Use the checkbox in the tree.</div>

  const toggle = (h: DiffHunk) =>
    run(async () => {
      if (h.source === 'staged') await api.wt.unstageHunks(root, path, [h.id])
      else await api.wt.stageHunks(root, path, [h.id])
      refreshRepo(root)
    }, 'Could not update the index')

  const discard = (h: DiffHunk) =>
    run(async () => {
      const ok = await confirm({
        title: 'Discard change',
        message: `Revert this change in ${path} (${h.header.replace(/^@@ (.*?) @@.*/, '$1')})? The working-tree edit is lost.`,
        confirmLabel: 'Discard',
        destructive: true
      })
      if (!ok) return
      await api.wt.discardHunks(root, path, [h.id])
      refreshRepo(root)
    }, 'Discard failed')

  return (
    <div className="h-full overflow-auto p-2 font-mono text-[12px]" data-testid="hunk-view">
      {all.map((h) => (
        <div key={h.id} className="mb-2 overflow-hidden rounded border border-border-strong" data-testid="hunk">
          <div className="flex items-center gap-2 bg-panel-2 px-2 py-0.5 font-sans text-xs">
            <Checkbox checked={h.source === 'staged'} onCheckedChange={() => toggle(h)} aria-label={h.source === 'staged' ? 'Unstage hunk' : 'Stage hunk'} />
            <span className="text-muted">{h.header}</span>
            <span className={cn('ml-auto rounded px-1', h.source === 'staged' ? 'bg-success/20 text-success' : 'text-muted')}>{h.source}</span>
            {h.source === 'unstaged' && (
              <button className="flex items-center gap-1 rounded px-1 text-muted hover:bg-hover hover:text-danger" title="Discard this change" onClick={() => discard(h)}>
                <Undo2 className="size-3" /> Discard
              </button>
            )}
          </div>
          <div className="selectable">
            {h.lines.map((l, i) => (
              <div
                key={i}
                className={cn(
                  'flex whitespace-pre',
                  l.kind === '+' && 'bg-[color-mix(in_srgb,var(--success)_16%,transparent)]',
                  l.kind === '-' && 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]'
                )}
              >
                <span className="w-10 shrink-0 select-none pr-1 text-right text-muted">{l.oldLine ?? ''}</span>
                <span className="w-10 shrink-0 select-none pr-1 text-right text-muted">{l.newLine ?? ''}</span>
                <span className="w-4 shrink-0 select-none text-center text-muted">{l.oldLine === null && l.newLine === null ? '' : l.kind}</span>
                <span className={cn(l.oldLine === null && l.newLine === null && 'italic text-muted')}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

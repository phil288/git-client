import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { FileHistoryEntry } from '@shared/types'
import { api } from '@/lib/api'
import { absoluteDate, formatDate, shortHash } from '@/lib/format'
import { showBlame, showInLog } from '@/lib/views'
import { cn } from '@/lib/utils'
import { useTabUi } from '@/hooks/useTabUi'
import { useEpoch } from '@/stores/repoEpoch'
import type { TabRef } from '@/stores/tabs'
import { SplitPane } from '@/components/SplitPane'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DiffViewer } from '../diff/LazyDiffViewer'

/** History of one file (follows renames) with the diff of each revision. */
export function FileHistoryView({ tab, path }: { tab: TabRef; path: string }) {
  const root = tab.path
  const epoch = useEpoch(root)
  const q = useQuery({ queryKey: ['repo', root, 'fileHistory', path, epoch], queryFn: () => api.history.file(root, path) })
  const [sel, setSel] = useState(0)
  const [h, setH] = useTabUi(tab.id, 'historyListHeight', 260)
  const list = q.data ?? []
  const cur: FileHistoryEntry | undefined = list[Math.min(sel, list.length - 1)]

  return (
    <SplitPane direction="vertical" size={h} onSizeChange={setH} minFirst={100}>
      <div className="flex h-full min-h-0 flex-col" data-testid="file-history">
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-strong bg-panel px-2 text-xs">
          <span className="font-semibold">History of {path}</span>
          <span className="text-muted">{list.length} revisions (follows renames)</span>
        </div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="min-h-0 flex-1 overflow-auto">
              {q.isLoading && <div className="p-3 text-muted">Loading…</div>}
              {q.isError && <div className="p-3 text-danger">{q.error.message}</div>}
              {list.map((e, i) => (
                <div
                  key={e.commit.hash}
                  onClick={() => setSel(i)}
                  onContextMenu={() => setSel(i)}
                  onDoubleClick={() => showInLog(e.commit.hash)}
                  className={cn('flex h-[22px] cursor-default items-center gap-3 px-2 text-[13px]', i === sel ? 'bg-selected' : 'hover:bg-hover')}
                >
                  <span className="w-20 shrink-0 font-mono text-xs text-muted">{shortHash(e.commit.hash)}</span>
                  <span className="w-28 shrink-0 truncate text-muted" title={absoluteDate(e.commit.authorTime)}>
                    {formatDate(e.commit.authorTime)}
                  </span>
                  <span className="w-32 shrink-0 truncate text-muted">{e.commit.authorName}</span>
                  <span className="min-w-0 flex-1 truncate">{e.commit.subject}</span>
                  {e.oldPath && <span className="shrink-0 truncate text-xs text-[var(--ref-remote)]">renamed from {e.oldPath}</span>}
                  {e.path !== path && !e.oldPath && <span className="shrink-0 truncate text-xs text-muted">{e.path}</span>}
                </div>
              ))}
            </div>
          </ContextMenuTrigger>
          {cur && (
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => showInLog(cur.commit.hash)}>Show in Log</ContextMenuItem>
              <ContextMenuItem onSelect={() => showBlame(cur.path, cur.commit.hash)}>Annotate This Revision</ContextMenuItem>
              <ContextMenuItem onSelect={() => void api.shell.copyText(cur.commit.hash)}>Copy Revision Hash</ContextMenuItem>
            </ContextMenuContent>
          )}
        </ContextMenu>
      </div>
      {cur ? (
        <DiffViewer
          root={root}
          left={{ rev: cur.status === 'A' ? null : (cur.commit.parents[0] ?? null), path: cur.oldPath ?? cur.path }}
          right={{ rev: cur.status === 'D' ? null : cur.commit.hash, path: cur.path }}
          title={`${cur.path} @ ${shortHash(cur.commit.hash)} — ${cur.commit.subject}`}
        />
      ) : (
        <div />
      )}
    </SplitPane>
  )
}

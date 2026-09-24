import { useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import type { Commit, FileChange } from '@shared/types'
import { api } from '@/lib/api'
import { absoluteDate, formatDate, shortHash } from '@/lib/format'
import { run } from '@/lib/notify'
import { FileTree } from '../common/FileTree'

export interface OpenFileRequest {
  change: FileChange
  /** Left revision (null when the file was added). */
  from: string | null
  to: string
}

interface Props {
  root: string
  commits: Commit[]
  /** Hash of the oldest selected commit's first parent is used for combined diffs. */
  selectedPath: string | null
  onOpenFile(req: OpenFileRequest): void
  onGoTo(hash: string): void
}

function Person({ label, name, email, time }: { label: string; name: string; email: string; time: number }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <span className="selectable min-w-0">
        {name} <span className="text-muted">&lt;{email}&gt;</span>{' '}
        <span className="text-muted" title={absoluteDate(time)}>
          {formatDate(time, 'absolute')}
        </span>
      </span>
    </div>
  )
}

/** Commit details: message, people, parents, containing refs and changed files. */
export function CommitDetailsPanel({ root, commits, selectedPath, onOpenFile, onGoTo }: Props) {
  const single = commits.length === 1 ? commits[0]! : null
  const details = useQuery({
    queryKey: ['commit', root, single?.hash],
    queryFn: () => api.repo.commitDetails(root, single!.hash),
    enabled: !!single,
    staleTime: Infinity
  })
  const containing = useQuery({
    queryKey: ['repo', root, 'containing', single?.hash],
    queryFn: () => api.repo.containing(root, single!.hash),
    enabled: !!single,
    staleTime: 60_000
  })
  // Several commits: combined diff from the oldest one's parent to the newest.
  const newest = commits[0]
  const oldest = commits[commits.length - 1]
  const combinedFrom = oldest?.parents[0] ?? null
  const combined = useQuery({
    queryKey: ['blob-changes', root, combinedFrom, newest?.hash],
    queryFn: () => api.repo.changes(root, combinedFrom, newest!.hash),
    enabled: commits.length > 1 && !!newest,
    staleTime: Infinity
  })

  if (commits.length === 0) return <div className="flex h-full items-center justify-center text-muted">Select a commit</div>

  if (!single) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="commit-details">
        <div className="max-h-48 shrink-0 overflow-auto border-b border-border-strong p-3">
          <div className="mb-1 font-semibold">{commits.length} commits selected — combined changes</div>
          {commits.map((c) => (
            <div key={c.hash} className="truncate text-xs">
              <span className="font-mono text-muted">{shortHash(c.hash)}</span> {c.subject}
            </div>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {combined.isLoading && <div className="p-3 text-muted">Loading…</div>}
          {combined.data && (
            <FileTree
              files={combined.data}
              selected={selectedPath}
              onSelect={(f) => onOpenFile({ change: f as FileChange, from: combinedFrom, to: newest!.hash })}
            />
          )}
        </div>
      </div>
    )
  }

  const d = details.data
  const from = single.parents[0] ?? null
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="commit-details">
      <div className="max-h-[55%] shrink-0 overflow-auto border-b border-border-strong p-3 text-[13px]">
        <pre className="selectable mb-3 whitespace-pre-wrap break-words font-sans font-medium">{d?.message ?? single.subject}</pre>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-muted">Commit</span>
            <span className="selectable font-mono">{single.hash}</span>
            <button className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg" title="Copy hash" onClick={() => run(() => api.shell.copyText(single.hash))}>
              <Copy className="size-3" />
            </button>
          </div>
          <Person label="Author" name={single.authorName} email={single.authorEmail} time={single.authorTime} />
          {(single.committerEmail !== single.authorEmail || single.committerTime !== single.authorTime) && (
            <Person label="Committer" name={single.committerName} email={single.committerEmail} time={single.committerTime} />
          )}
          <div className="flex gap-2">
            <span className="w-20 shrink-0 text-muted">Parents</span>
            <span className="flex flex-wrap gap-2">
              {single.parents.length === 0 && <span className="text-muted">(root commit)</span>}
              {single.parents.map((p) => (
                <button key={p} className="font-mono text-accent hover:underline" onClick={() => onGoTo(p)}>
                  {shortHash(p)}
                </button>
              ))}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="w-20 shrink-0 text-muted">In</span>
            <span className="selectable min-w-0">
              {containing.isLoading ? (
                <span className="text-muted">looking up branches and tags…</span>
              ) : containing.data ? (
                <>
                  {containing.data.branches.length + containing.data.tags.length === 0 && <span className="text-muted">no branch or tag</span>}
                  {containing.data.branches.slice(0, 20).join(', ')}
                  {containing.data.branches.length > 20 && ` and ${containing.data.branches.length - 20} more`}
                  {containing.data.tags.length > 0 && (
                    <div className="text-muted">
                      Tags: {containing.data.tags.slice(0, 10).join(', ')}
                      {containing.data.tags.length > 10 && ` and ${containing.data.tags.length - 10} more`}
                    </div>
                  )}
                </>
              ) : null}
            </span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {details.isLoading && <div className="p-3 text-muted">Loading…</div>}
        {details.isError && <div className="p-3 text-danger">{details.error.message}</div>}
        {d && d.files.length === 0 && <div className="p-3 text-muted">No changes (empty commit)</div>}
        {d && (
          <FileTree files={d.files} selected={selectedPath} onSelect={(f) => onOpenFile({ change: f as FileChange, from, to: single.hash })} />
        )}
        {d && single.parents.length > 1 && (
          <div className="px-3 py-1 text-[11px] text-muted">Merge commit: changes shown against the first parent.</div>
        )}
      </div>
    </div>
  )
}

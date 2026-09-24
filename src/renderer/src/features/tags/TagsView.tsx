import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GitCompareArrows, Plus, Tag } from 'lucide-react'
import { fuzzyFilter } from '@shared/fuzzy'
import type { TagEntry } from '@shared/types'
import { compareVersionNames } from '@shared/versions'
import { api } from '@/lib/api'
import { formatDate, shortHash } from '@/lib/format'
import { checkoutFlow } from '@/lib/gitOps'
import { run } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { showInLog } from '@/lib/views'
import { useTabUi } from '@/hooks/useTabUi'
import { useEpoch } from '@/stores/repoEpoch'
import { openModal } from '@/stores/modals'
import type { TabRef } from '@/stores/tabs'
import { SplitPane } from '@/components/SplitPane'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { ComparePanel } from '../branches/BranchDialogs'
import { tagMenuItems } from '../branches/BranchMenu'
import { RefSelect, type RefChoice } from '../common/RefSelect'
import { useRefs } from '../log/LogView'

type TagSort = 'version' | 'date' | 'name'

export function useTags(root: string) {
  const epoch = useEpoch(root)
  return useQuery({ queryKey: ['repo', root, 'tags', epoch], queryFn: () => api.tag.list(root) })
}

export function sortTags(tags: TagEntry[], sort: TagSort): TagEntry[] {
  const list = [...tags]
  if (sort === 'version') list.sort((a, b) => compareVersionNames(b.name, a.name))
  else if (sort === 'date') list.sort((a, b) => b.date - a.date || compareVersionNames(b.name, a.name))
  else list.sort((a, b) => a.name.localeCompare(b.name))
  return list
}

const tagRev = (t: TagEntry): RefChoice => ({ rev: `refs/tags/${t.name}`, label: t.name })

function useHead(root: string) {
  return useQuery({ queryKey: ['repo', root, 'info'], queryFn: () => api.repo.info(root) }).data?.branch ?? null
}

/** Opens the Compare dialog; the newer tag (by version) goes on the left. */
function compareTags(root: string, x: TagEntry, y: TagEntry): void {
  const [a, b] = compareVersionNames(x.name, y.name) >= 0 ? [x, y] : [y, x]
  openModal({ kind: 'compare', root, a: tagRev(a).rev, aLabel: a.name, b: tagRev(b).rev, bLabel: b.name })
}

function TagMenu({ root, t, head, previous }: { root: string; t: TagEntry; head: string | null; previous: TagEntry | null }) {
  const ref = useRefs(root).data?.find((r) => r.kind === 'tag' && r.short === t.name)
  const cur = head ?? 'HEAD'
  return (
    <>
      <ContextMenuItem onSelect={() => showInLog(t.hash)}>Show in Log</ContextMenuItem>
      <ContextMenuItem onSelect={() => void checkoutFlow(root, { kind: 'tag', name: t.name })}>Checkout</ContextMenuItem>
      <ContextMenuItem onSelect={() => openModal({ kind: 'newBranch', root, start: tagRev(t).rev, startLabel: t.name })}>New Branch from ‘{t.name}’…</ContextMenuItem>
      <ContextMenuItem onSelect={() => openModal({ kind: 'addWorktree', root, start: t.name })}>New Worktree from ‘{t.name}’…</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => openModal({ kind: 'compare', root, a: tagRev(t).rev, aLabel: t.name, b: 'HEAD', bLabel: cur })}>
        Compare with ‘{cur}’
      </ContextMenuItem>
      {previous && <ContextMenuItem onSelect={() => compareTags(root, t, previous)}>Compare with Previous Tag (‘{previous.name}’)</ContextMenuItem>}
      <ContextMenuItem onSelect={() => openModal({ kind: 'worktreeDiff', root, rev: tagRev(t).rev, label: t.name })}>Show Diff with Working Tree</ContextMenuItem>
      {ref && tagMenuItems.render?.({ root, r: ref })}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => run(() => api.shell.copyText(t.name))}>Copy Name</ContextMenuItem>
    </>
  )
}

function TagDetails({ root, t, previous, head }: { root: string; t: TagEntry; previous: TagEntry | null; head: string | null }) {
  // Keyed by tag + previous tag in the parent, so the base resets when another tag is selected.
  const [base, setBase] = useState<RefChoice>(() => (previous ? tagRev(previous) : { rev: 'HEAD', label: head ?? 'HEAD' }))
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2" data-testid="tag-details">
      <div className="shrink-0 space-y-1">
        <div className="flex items-center gap-2">
          <Tag className="size-4 text-muted" />
          <span className="text-[15px] font-semibold">{t.name}</span>
          <span className="rounded bg-hover px-1 text-[10px] uppercase leading-4 text-muted">{t.annotated ? 'annotated' : 'lightweight'}</span>
        </div>
        <div className="flex gap-2 text-xs text-muted">
          <button className="font-mono hover:text-accent hover:underline" onClick={() => showInLog(t.hash)} title="Show in Log">
            {shortHash(t.hash)}
          </button>
          <span className="truncate">{t.commitSubject}</span>
        </div>
        {t.annotated && (
          <>
            <div className="text-xs text-muted">
              Tagged by {t.tagger ?? 'unknown'}, {formatDate(t.date)}
            </div>
            {t.message && <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg p-2 font-sans text-[13px]">{t.message}</pre>}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
        Compare with
        <RefSelect root={root} value={base} onChange={setBase} headLabel={head} testId="tag-compare-base" />
      </div>
      <div className="min-h-0 flex-1">
        <ComparePanel key={`${t.name}\0${base.rev}`} root={root} a={tagRev(t)} b={base} onOpenCommit={(c) => showInLog(c.hash)} />
      </div>
    </div>
  )
}

/** All tags with filter / sort; select one to see what changed since the previous tag (or any branch / tag). */
export function TagsView({ tab }: { tab: TabRef }) {
  const root = tab.path
  const q = useTags(root)
  const head = useHead(root)
  const [sort, setSort] = useTabUi<TagSort>(tab.id, 'tagSort', 'version')
  const [w, setW] = useTabUi(tab.id, 'tagListWidth', 380)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [checked, setChecked] = useState<string[]>([])

  const sorted = useMemo(() => sortTags(q.data ?? [], sort), [q.data, sort])
  // "Previous" always means the next older version, whatever the list order.
  const byVersion = useMemo(() => sortTags(q.data ?? [], 'version'), [q.data])
  const previousOf = (t: TagEntry) => byVersion[byVersion.findIndex((x) => x.name === t.name) + 1] ?? null
  const shown = useMemo(() => (filter.trim() ? fuzzyFilter(sorted, filter, (t) => [t.name, t.commitSubject]) : sorted), [sorted, filter])
  const current = sorted.find((t) => t.name === selected) ?? shown[0] ?? null
  const pair = checked.map((n) => sorted.find((t) => t.name === n)).filter((t): t is TagEntry => !!t)

  // Drop checks for tags that were deleted.
  useEffect(() => {
    if (q.data) setChecked((c) => c.filter((n) => q.data.some((t) => t.name === n)))
  }, [q.data])

  const toggle = (name: string) => setChecked((c) => (c.includes(name) ? c.filter((n) => n !== name) : [...c.slice(-1), name]))

  return (
    <SplitPane direction="horizontal" size={w} onSizeChange={setW} minFirst={260}>
      <div className="flex h-full min-h-0 flex-col" data-testid="tags-view">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-strong bg-panel px-2">
          <Button size="sm" variant="ghost" onClick={() => openModal({ kind: 'newTag', root, target: 'HEAD', label: head ?? 'HEAD' })} data-testid="tag-new">
            <Plus /> New Tag…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pair.length !== 2}
            title="Tick two tags to compare them"
            onClick={() => compareTags(root, pair[0]!, pair[1]!)}
            data-testid="tag-compare-selected"
          >
            <GitCompareArrows /> Compare{pair.length === 2 ? ` ${pair[0]!.name} ↔ ${pair[1]!.name}` : ''}
          </Button>
          <select
            className="ml-auto h-6 rounded border border-border-strong bg-bg px-1 text-xs"
            value={sort}
            onChange={(e) => setSort(e.target.value as TagSort)}
            title="Sort"
            data-testid="tag-sort"
          >
            <option value="version">Version</option>
            <option value="date">Date</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="shrink-0 border-b border-border p-1.5">
          <Input placeholder="Filter tags" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="tag-filter" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {q.isLoading && <div className="p-3 text-muted">Loading…</div>}
          {q.isError && <div className="p-3 text-danger">{q.error.message}</div>}
          {q.data && q.data.length === 0 && <div className="p-3 text-muted">No tags. Create one with New Tag… or from a commit in the Log.</div>}
          {q.data && q.data.length > 0 && shown.length === 0 && <div className="p-3 text-muted">No matching tags</div>}
          {shown.map((t) => (
            <ContextMenu key={t.name}>
              <ContextMenuTrigger asChild>
                <div
                  data-testid="tag-row"
                  data-name={t.name}
                  onClick={() => setSelected(t.name)}
                  onDoubleClick={() => showInLog(t.hash)}
                  className={cn('flex cursor-default items-center gap-2 border-b border-border px-2 py-1 hover:bg-hover', current?.name === t.name && 'bg-selected')}
                >
                  <span onClick={(e) => e.stopPropagation()} className="flex">
                    <Checkbox checked={checked.includes(t.name)} onCheckedChange={() => toggle(t.name)} aria-label={`Select ${t.name} for comparison`} />
                  </span>
                  <Tag className={cn('size-3.5 shrink-0', t.annotated ? 'text-accent' : 'text-muted')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-medium">{t.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted">{formatDate(t.date)}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      <span className="font-mono">{shortHash(t.hash)}</span> {t.annotated && t.message ? t.message.split('\n')[0] : t.commitSubject}
                    </div>
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <TagMenu root={root} t={t} head={head} previous={previousOf(t)} />
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      </div>
      {current ? (
        <TagDetails key={`${current.name}\0${previousOf(current)?.name ?? ''}`} root={root} t={current} previous={previousOf(current)} head={head} />
      ) : (
        <div className="flex h-full items-center justify-center text-muted">Select a tag</div>
      )}
    </SplitPane>
  )
}

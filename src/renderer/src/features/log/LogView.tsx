import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Commit, LogQuery, Ref } from '@shared/types'
import { api } from '@/lib/api'
import { notifyError } from '@/lib/notify'
import { useTabUi } from '@/hooks/useTabUi'
import { useEpoch } from '@/stores/repoEpoch'
import type { RepoTab } from '@/stores/tabs'
import { SplitPane } from '@/components/SplitPane'
import { DiffViewer, type DiffSide } from '../diff/DiffViewer'
import { CommitDetailsPanel, type OpenFileRequest } from './CommitDetailsPanel'
import { useLogModel } from './logModel'
import { EMPTY_SELECTION, LogTable, type LogTableHandle, type Selection } from './LogTable'
import { LogToolbar } from './LogToolbar'

const DEFAULT_QUERY: LogQuery = { revs: [] }

export function useRefs(root: string) {
  return useQuery({ queryKey: ['repo', root, 'refs'], queryFn: () => api.repo.refs(root), staleTime: 10_000 })
}

export function refsByHash(refs: Ref[] | undefined): Map<string, Ref[]> {
  const m = new Map<string, Ref[]>()
  for (const r of refs ?? []) {
    const list = m.get(r.hash)
    if (list) list.push(r)
    else m.set(r.hash, [r])
  }
  return m
}

/** Structural filters keep the graph; text/author/date filters show a flat list. */
export function graphApplies(q: LogQuery): boolean {
  return !q.text && !(q.authors?.length) && !q.since && !q.until
}

interface Props {
  tab: RepoTab
  headSha: string | null
  detached: boolean
  /** Left sidebar (branches, M4). */
  sidebar?: (ctx: { query: LogQuery; setQuery(q: LogQuery): void; goTo(hash: string): Promise<void> }) => React.ReactNode
  renderMenu?: (selected: Commit[], ctx: { goTo(hash: string): Promise<void>; openDiff(left: DiffSide, right: DiffSide, title?: string): void }) => React.ReactNode
}

/** JetBrains "Log" tab: filters, graph table, details and diff. */
export function LogView({ tab, headSha, detached, sidebar, renderMenu }: Props) {
  const root = tab.path
  const epoch = useEpoch(root)
  const [query, setQuery] = useTabUi<LogQuery>(tab.id, 'logQuery', DEFAULT_QUERY)
  const [selection, setSelection] = useTabUi<Selection>(tab.id, 'logSelection', EMPTY_SELECTION)
  const [detailsW, setDetailsW] = useTabUi(tab.id, 'logDetailsWidth', 420)
  const [diffH, setDiffH] = useTabUi(tab.id, 'logDiffHeight', 360)
  const [sidebarW, setSidebarW] = useTabUi(tab.id, 'logSidebarWidth', 240)
  const [diff, setDiff] = useState<{ left: DiffSide; right: DiffSide; title?: string } | null>(null)
  const tableRef = useRef<LogTableHandle>(null)

  const showGraph = graphApplies(query)
  const model = useLogModel(root, query, showGraph, epoch)
  const refs = useRefs(root)
  const byHash = useMemo(() => refsByHash(refs.data), [refs.data])

  const selectedCommits = useMemo(
    () =>
      selection.hashes
        .map((h) => model.index.get(h))
        .filter((i): i is number => i !== undefined)
        .sort((a, b) => a - b)
        .map((i) => model.commits[i]!),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- model mutates; version drives re-render
    [selection.hashes, model, model.commits.length]
  )

  const goTo = useCallback(
    async (hash: string) => {
      const idx = await model.loadUntil(hash)
      if (idx < 0) {
        notifyError(new Error(`Commit ${hash.slice(0, 8)} is not in the current log (check the filters).`))
        return
      }
      setSelection({ hashes: [hash], focus: hash, anchor: hash })
      requestAnimationFrame(() => tableRef.current?.scrollTo(hash))
    },
    [model, setSelection]
  )

  // Most frequent authors among the first loaded commits, for the User filter.
  const authors = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of model.commits.slice(0, 5000)) counts.set(c.authorName, (counts.get(c.authorName) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed as pages arrive
  }, [model, model.commits.length > 0, model.done])

  const openFile = (req: OpenFileRequest) => {
    const c = req.change
    setDiff({
      left: { rev: c.status === 'A' ? null : req.from, path: c.oldPath ?? c.path },
      right: { rev: c.status === 'D' ? null : req.to, path: c.path }
    })
  }
  const openDiff = (left: DiffSide, right: DiffSide, title?: string) => setDiff({ left, right, title })
  const ctx = { query, setQuery, goTo }

  const main = (
    <SplitPane direction="vertical" size={diffH} onSizeChange={setDiffH} sizeSecond collapsed={!diff} minSecond={120}>
      <SplitPane direction="horizontal" size={detailsW} onSizeChange={setDetailsW} sizeSecond minSecond={260}>
        <div className="flex h-full min-h-0 flex-col">
          <LogToolbar root={root} query={query} setQuery={setQuery} goTo={goTo} refs={refs.data ?? []} authors={authors} />
          <LogTable
            ref={tableRef}
            model={model}
            refsByHash={byHash}
            headSha={headSha}
            detached={detached}
            showGraph={showGraph}
            selection={selection}
            onSelectionChange={setSelection}
            renderMenu={renderMenu ? (sel) => renderMenu(sel, { goTo, openDiff }) : undefined}
          />
        </div>
        <CommitDetailsPanel
          root={root}
          commits={selectedCommits}
          selectedPath={diff?.right.path ?? null}
          onOpenFile={openFile}
          onGoTo={(h) => void goTo(h)}
        />
      </SplitPane>
      {diff ? <DiffViewer root={root} left={diff.left} right={diff.right} title={diff.title} onClose={() => setDiff(null)} /> : <div />}
    </SplitPane>
  )

  if (!sidebar) return main
  return (
    <SplitPane direction="horizontal" size={sidebarW} onSizeChange={setSidebarW} minFirst={160}>
      {sidebar(ctx)}
      {main}
    </SplitPane>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Editor, { type OnMount } from '@monaco-editor/react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Columns3, Eye, Replace, RotateCcw, Rows3, Search, X } from 'lucide-react'
import { hasConflictMarkers, merge3, splitLines, wordDiff, type Merge3Options, type MergeRegion } from '@shared/merge3'
import {
  anchors,
  applyAction,
  buildChunks,
  chunkContent,
  counts,
  isResolved,
  layoutResult,
  mapLine,
  resetChunks,
  type Chunk,
  type ChunkAction
} from '@shared/mergeModel'
import type { ConflictState, ConflictVersions } from '@shared/types'
import { api } from '@/lib/api'
import { refreshRepo } from '@/lib/gitOps'
import { languageForPath, monaco } from '@/lib/monaco'
import { notifyError } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useMonacoTheme } from '@/hooks/usePrefersDark'
import { confirm } from '@/stores/dialogs'
import { Button } from '@/components/ui/button'

type IEditor = monaco.editor.IStandaloneCodeEditor

const STRIP_W = 52

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 12,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  glyphMargin: false,
  folding: false,
  lineNumbersMinChars: 3,
  renderLineHighlight: 'none',
  overviewRulerLanes: 0,
  scrollbar: { alwaysConsumeMouseWheel: false }
}

/** Open Monaco's find (or find/replace) widget in a pane. */
function openFind(ed: IEditor | null, replace = false) {
  if (!ed) return
  ed.focus()
  void ed.getAction(replace ? 'editor.action.startFindReplaceAction' : 'actions.find')?.run()
}

const paneBtn = 'ml-auto flex shrink-0 items-center rounded p-0.5 text-muted hover:bg-hover hover:text-fg'

function chunkClass(c: Chunk, side: 'left' | 'right' | 'result'): string {
  const lines = side === 'left' ? c.ours : side === 'right' ? c.theirs : chunkContent(c)
  const done = isResolved(c)
  let k: string
  if (c.kind === 'conflict') k = 'mc-conflict'
  else if (c.base.length === 0) k = 'mc-added'
  else if (lines.length === 0) k = 'mc-deleted'
  else k = 'mc-modified'
  if (side === 'left' && c.left !== 'pending' && c.kind !== 'conflict') k = 'mc-neutral'
  if (side === 'right' && c.right !== 'pending' && c.kind !== 'conflict') k = 'mc-neutral'
  return `${k}${done ? ' mc-done' : ''}`
}

function chunkColor(c: Chunk): string {
  if (isResolved(c)) return 'color-mix(in srgb, var(--muted) 18%, transparent)'
  if (c.kind === 'conflict') return 'color-mix(in srgb, var(--danger) 30%, transparent)'
  if (c.base.length === 0) return 'color-mix(in srgb, var(--success) 30%, transparent)'
  return 'color-mix(in srgb, var(--accent) 28%, transparent)'
}

const STYLE = `
.mc-conflict { background: color-mix(in srgb, var(--danger) 22%, transparent); }
.mc-added { background: color-mix(in srgb, var(--success) 20%, transparent); }
.mc-modified { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.mc-deleted { background: color-mix(in srgb, var(--muted) 22%, transparent); }
.mc-neutral { background: color-mix(in srgb, var(--muted) 10%, transparent); }
.mc-done { opacity: .45; }
.mc-empty { border-top: 2px solid color-mix(in srgb, var(--danger) 70%, transparent); }
.mc-empty.mc-done { border-top-color: color-mix(in srgb, var(--muted) 60%, transparent); }
.mc-word { background: color-mix(in srgb, var(--warning) 45%, transparent); border-radius: 2px; }
.mc-current { box-shadow: inset 3px 0 0 var(--accent); }
.mc-zone { font-family: var(--font-mono); font-size: 12px; padding: 4px 8px; border-left: 3px solid var(--danger); background: var(--panel); overflow: hidden; }
.mc-zone button { font-family: var(--font-sans); font-size: 11px; margin-right: 6px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--fg); cursor: pointer; }
.mc-zone pre { margin: 2px 0 6px; white-space: pre; }
`

interface Props {
  root: string
  path: string
  state: ConflictState
  onClose(saved: boolean): void
}

interface Snapshot {
  chunks: Chunk[]
  ranges: [number, number][]
}

/**
 * JetBrains-style 3-way merge: Yours | Result | Theirs, per-chunk actions in
 * the gutters between panes, connector curves, synchronised scrolling,
 * F7/Shift+F7 navigation, undoable actions, base overlay and inline mode.
 */
export function MergeEditor({ root, path, state, onClose }: Props) {
  const q = useQuery({ queryKey: ['conflict-versions', root, path], queryFn: () => api.conflicts.versions(root, path), staleTime: Infinity, gcTime: 0 })
  if (q.isError) return <div className="p-6 text-danger">{q.error.message}</div>
  if (!q.data) return <div className="p-6 text-muted">Loading versions…</div>
  return <MergeEditorInner root={root} path={path} state={state} v={q.data} onClose={onClose} />
}

function MergeEditorInner({ root, path, state, v, onClose }: Props & { v: ConflictVersions }) {
  const theme = useMonacoTheme()
  const language = languageForPath(path)
  const eol = v.eol
  const [ws, setWs] = useState<NonNullable<Merge3Options['ignoreWhitespace']>>('none')
  const [layout, setLayout] = useState<'side' | 'inline'>('side')
  const [showBase, setShowBase] = useState(false)
  const baseLines = useMemo(() => splitLines(v.base.text), [v.base.text])
  const oursLines = useMemo(() => splitLines(v.yours.text), [v.yours.text])
  const theirsLines = useMemo(() => splitLines(v.theirs.text), [v.theirs.text])
  const regions: MergeRegion[] = useMemo(() => merge3(baseLines, oursLines, theirsLines, { ignoreWhitespace: ws }), [baseLines, oursLines, theirsLines, ws])

  const [chunks, setChunksState] = useState<Chunk[]>(() => buildChunks(regions))
  const chunksRef = useRef(chunks)
  const setChunks = (c: Chunk[]) => {
    chunksRef.current = c
    setChunksState(c)
  }
  const [current, setCurrent] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [, force] = useState(0)

  const left = useRef<IEditor | null>(null)
  const right = useRef<IEditor | null>(null)
  const result = useRef<IEditor | null>(null)
  const baseEd = useRef<IEditor | null>(null)
  const decoIds = useRef<string[]>([])
  const leftDeco = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const rightDeco = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const resultStyle = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const snapshots = useRef(new Map<number, Snapshot>())
  const syncing = useRef(false)
  const zones = useRef<string[]>([])
  const [mounted, setMounted] = useState(0)

  const initial = useMemo(() => {
    const r = layoutResult(regions, buildChunks(regions))
    return r.lines.join(eol) + eol // always one trailing EOL line while editing
  }, [regions, eol])

  // --------------------------------------------------------------------------
  // Result block tracking (Monaco decorations follow manual edits)
  // --------------------------------------------------------------------------
  const blockOf = useCallback((i: number): [number, number] | null => {
    const m = result.current?.getModel()
    const id = decoIds.current[i]
    if (!m || !id) return null
    const r = m.getDecorationRange(id)
    if (!r) return null
    const end = r.endColumn === 1 ? r.endLineNumber : r.endLineNumber + 1
    return [r.startLineNumber, Math.max(end, r.startLineNumber)]
  }, [])

  const setBlocks = useCallback((ranges: [number, number][]) => {
    const m = result.current?.getModel()
    if (!m) return
    decoIds.current = m.deltaDecorations(
      decoIds.current,
      ranges.map(([s, e]) => ({
        range: new monaco.Range(s, 1, e, 1),
        options: { stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }
      }))
    )
  }, [])

  const currentRanges = (): [number, number][] => chunksRef.current.map((_, i) => blockOf(i) ?? [1, 1])

  const snapshot = () => {
    const m = result.current?.getModel()
    if (!m) return
    snapshots.current.set(m.getAlternativeVersionId(), { chunks: chunksRef.current, ranges: currentRanges() })
  }

  const initBlocks = useCallback(() => {
    const r = layoutResult(regions, chunksRef.current)
    setBlocks(r.starts.map((s, i) => [s + 1, s + 1 + r.lengths[i]!]))
  }, [regions, setBlocks])

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------
  const replaceBlock = (i: number, lines: string[]) => {
    const ed = result.current
    const m = ed?.getModel()
    const b = blockOf(i)
    if (!ed || !m || !b) return
    const [s, e] = b
    const text = lines.map((l) => l + eol).join('')
    m.pushEditOperations([], [{ range: new monaco.Range(s, 1, e, 1), text }], () => null)
    const ranges = currentRanges()
    ranges[i] = [s, s + lines.length]
    setBlocks(ranges)
  }

  const act = (ids: number[], action: ChunkAction) => {
    const m = result.current?.getModel()
    if (!m) return
    m.pushStackElement()
    const next = [...chunksRef.current]
    for (const i of ids) {
      const before = next[i]!
      const after = applyAction(before, action)
      next[i] = after
      chunksRef.current = next
      if (after.order.join() !== before.order.join()) replaceBlock(i, chunkContent(after))
    }
    m.pushStackElement()
    setChunks(next)
    setDirty(true)
    snapshot()
    result.current?.focus()
  }

  const applyAll = (filter: (c: Chunk) => boolean, action: ChunkAction) => {
    const ids = chunksRef.current.map((c, i) => (filter(c) ? i : -1)).filter((i) => i >= 0)
    if (ids.length) act(ids, action)
  }

  const resetResult = async () => {
    const ok = await confirm({ title: 'Reset result', message: 'Replace the result with the original (base) version and undo every applied change?', confirmLabel: 'Reset' })
    if (!ok) return
    const m = result.current?.getModel()
    if (!m) return
    const reset = resetChunks(chunksRef.current)
    const r = layoutResult(regions, reset)
    m.pushStackElement()
    m.pushEditOperations([], [{ range: m.getFullModelRange(), text: r.lines.join(eol) + eol }], () => null)
    m.pushStackElement()
    setChunks(reset)
    setBlocks(r.starts.map((s, i) => [s + 1, s + 1 + r.lengths[i]!]))
    setDirty(true)
    snapshot()
  }

  const navigate = (dir: 1 | -1) => {
    const list = chunksRef.current
    const pending = list.map((c, i) => (!isResolved(c) ? i : -1)).filter((i) => i >= 0)
    const pool = pending.length ? pending : list.map((_, i) => i)
    if (!pool.length) return
    const cur = current ?? (dir === 1 ? -1 : list.length)
    const nextIdx = dir === 1 ? (pool.find((i) => i > cur) ?? pool[0]!) : ([...pool].reverse().find((i) => i < cur) ?? pool[pool.length - 1]!)
    setCurrent(nextIdx)
    const b = blockOf(nextIdx)
    if (b) result.current?.revealLineInCenter(b[0])
  }

  // Undo/redo restores chunk states recorded for that model version.
  const onResultMount: OnMount = (ed) => {
    result.current = ed
    const m = ed.getModel()!
    m.setEOL(eol === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
    resultStyle.current = ed.createDecorationsCollection()
    initBlocks()
    snapshot()
    m.onDidChangeContent((e) => {
      if (e.isUndoing || e.isRedoing) {
        const snap = snapshots.current.get(m.getAlternativeVersionId())
        if (snap) {
          setChunks(snap.chunks)
          setBlocks(snap.ranges)
        }
      } else if (!e.isFlush) setDirty(true)
      force((n) => n + 1)
    })
    ed.onDidScrollChange(() => syncFrom('result'))
    ed.addCommand(monaco.KeyCode.F7, () => navigate(1))
    ed.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => navigate(-1))
    setMounted((n) => n + 1)
  }
  const onSideMount =
    (which: 'left' | 'right'): OnMount =>
    (ed) => {
      ;(which === 'left' ? left : right).current = ed
      if (which === 'left') leftDeco.current = ed.createDecorationsCollection()
      else rightDeco.current = ed.createDecorationsCollection()
      ed.onDidScrollChange(() => syncFrom(which))
      ed.addCommand(monaco.KeyCode.F7, () => navigate(1))
      ed.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => navigate(-1))
      setMounted((n) => n + 1)
    }

  // --------------------------------------------------------------------------
  // Scroll sync
  // --------------------------------------------------------------------------
  const anchorList = () => {
    const starts: number[] = []
    const lengths: number[] = []
    chunksRef.current.forEach((_, i) => {
      const b = blockOf(i) ?? [1, 1]
      starts.push(b[0] - 1)
      lengths.push(b[1] - b[0])
    })
    return anchors(chunksRef.current, starts, lengths)
  }
  const syncFrom = (src: 'left' | 'result' | 'right') => {
    if (syncing.current) return
    const eds = { left: left.current, result: result.current, right: right.current }
    const from = eds[src]
    if (!from) return
    syncing.current = true
    try {
      const idx = { left: 0, result: 1, right: 2 } as const
      const lh = from.getOption(monaco.editor.EditorOption.lineHeight)
      const topLine = from.getScrollTop() / lh
      const list = anchorList()
      for (const k of ['left', 'result', 'right'] as const) {
        if (k === src || !eds[k]) continue
        const mapped = mapLine(list, idx[src], idx[k], topLine)
        eds[k]!.setScrollTop(mapped * lh)
      }
    } finally {
      syncing.current = false
    }
    force((n) => n + 1) // redraw connectors
  }

  // --------------------------------------------------------------------------
  // Decorations
  // --------------------------------------------------------------------------
  useEffect(() => {
    const sideDecos = (side: 'left' | 'right') => {
      const out: monaco.editor.IModelDeltaDecoration[] = []
      chunks.forEach((c, i) => {
        const lines = side === 'left' ? c.ours : c.theirs
        const start = (side === 'left' ? c.oursStart : c.theirsStart) + 1
        const cls = chunkClass(c, side) + (current === i ? ' mc-current' : '')
        if (lines.length === 0) {
          out.push({ range: new monaco.Range(start, 1, start, 1), options: { isWholeLine: true, className: `mc-empty${isResolved(c) ? ' mc-done' : ''}` } })
          return
        }
        out.push({ range: new monaco.Range(start, 1, start + lines.length - 1, 1), options: { isWholeLine: true, className: cls } })
        // Word-level highlights where lines correspond one-to-one.
        const other = c.kind === 'conflict' ? (side === 'left' ? c.theirs : c.ours) : c.base
        if (other.length === lines.length) {
          lines.forEach((l, j) => {
            for (const [a, b] of wordDiff(other[j]!, l).b) {
              if (b > a) out.push({ range: new monaco.Range(start + j, a + 1, start + j, b + 1), options: { inlineClassName: 'mc-word' } })
            }
          })
        }
      })
      return out
    }
    leftDeco.current?.set(sideDecos('left'))
    rightDeco.current?.set(sideDecos('right'))
    const res: monaco.editor.IModelDeltaDecoration[] = []
    chunks.forEach((c, i) => {
      const b = blockOf(i)
      if (!b) return
      const [s, e] = b
      const cls = chunkClass(c, 'result') + (current === i ? ' mc-current' : '')
      if (e <= s) res.push({ range: new monaco.Range(s, 1, s, 1), options: { isWholeLine: true, className: `mc-empty${isResolved(c) ? ' mc-done' : ''}` } })
      else res.push({ range: new monaco.Range(s, 1, e - 1, 1), options: { isWholeLine: true, className: cls } })
    })
    resultStyle.current?.set(res)
  }, [chunks, current, mounted, blockOf])

  // Side editors unmount in inline mode: drop their (disposed) instances.
  useEffect(() => {
    if (layout === 'inline') {
      left.current = null
      right.current = null
    }
  }, [layout])

  // Inline mode: view zones with Yours / Theirs above each unresolved conflict.
  useEffect(() => {
    const ed = result.current
    if (!ed) return
    ed.changeViewZones((acc) => {
      for (const z of zones.current) acc.removeZone(z)
      zones.current = []
      if (layout !== 'inline') return
      chunks.forEach((c, i) => {
        if (c.kind !== 'conflict' || isResolved(c)) return
        const b = blockOf(i)
        if (!b) return
        const dom = document.createElement('div')
        dom.className = 'mc-zone'
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        dom.innerHTML =
          `<div><b>Yours: ${esc(state.yours.name)}</b> <span style="opacity:.7">(${esc(state.yours.detail)})</span></div><pre>${esc(c.ours.join('\n')) || '(nothing)'}</pre>` +
          `<div><b>Theirs: ${esc(state.theirs.name)}</b> <span style="opacity:.7">(${esc(state.theirs.detail)})</span></div><pre>${esc(c.theirs.join('\n')) || '(nothing)'}</pre>`
        const bar = document.createElement('div')
        for (const [label, action] of [
          ['Accept Yours', 'L'],
          ['Accept Theirs', 'R'],
          ['Yours then Theirs', 'bothLR'],
          ['Theirs then Yours', 'bothRL']
        ] as const) {
          const btn = document.createElement('button')
          btn.textContent = label
          btn.onclick = () => act([i], action === 'L' ? 'takeLeft' : action === 'R' ? 'takeRight' : action)
          bar.appendChild(btn)
        }
        dom.appendChild(bar)
        const heightInLines = c.ours.length + c.theirs.length + 5
        zones.current.push(acc.addZone({ afterLineNumber: b[0] - 1, heightInLines, domNode: dom }))
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- act/blockOf read refs
  }, [chunks, layout, mounted])

  // --------------------------------------------------------------------------
  // Save / close
  // --------------------------------------------------------------------------
  const c = counts(chunks)

  const save = async () => {
    const m = result.current?.getModel()
    if (!m) return
    let text = m.getValue()
    if (text.endsWith(eol)) text = text.slice(0, -eol.length)
    if (v.finalNewline && text.length > 0) text += eol
    if (hasConflictMarkers(text)) {
      const ok = await confirm({ title: 'Conflict markers left', message: 'The result still contains conflict markers (<<<<<<<, =======, >>>>>>>). Save and mark as resolved anyway?', confirmLabel: 'Save Anyway', destructive: true })
      if (!ok) return
    } else if (c.conflicts > 0) {
      const ok = await confirm({ title: 'Unresolved conflicts', message: `${c.conflicts} conflict${c.conflicts === 1 ? ' is' : 's are'} not resolved yet (the result keeps the base text there). Save and mark as resolved anyway?`, confirmLabel: 'Save Anyway' })
      if (!ok) return
    }
    try {
      await api.conflicts.save(root, path, text, v.yours.exists ? v.yours.encoding : v.theirs.encoding)
      refreshRepo(root)
      toast.success(`${path} resolved`)
      onClose(true)
    } catch (err) {
      notifyError(err, 'Could not save the result')
    }
  }

  const close = async () => {
    if (dirty) {
      const ok = await confirm({ title: 'Discard merge', message: 'Close the merge editor without saving? Your changes to the result are lost.', confirmLabel: 'Discard', destructive: true })
      if (!ok) return
    }
    onClose(false)
  }

  const changeWs = async (next: typeof ws) => {
    if (dirty) {
      const ok = await confirm({ title: 'Recompute changes', message: 'Changing the whitespace mode recomputes the chunks and resets the result. Continue?', confirmLabel: 'Reset' })
      if (!ok) return
    }
    setWs(next)
  }
  // Recompute chunks and the result when the whitespace mode changes.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const fresh = buildChunks(regions)
    setChunks(fresh)
    const m = result.current?.getModel()
    if (m) {
      const r = layoutResult(regions, fresh)
      m.setValue(r.lines.join(eol) + eol)
      setBlocks(r.starts.map((s, i) => [s + 1, s + 1 + r.lengths[i]!]))
      snapshots.current.clear()
      snapshot()
      setDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on regions change
  }, [regions])

  // --------------------------------------------------------------------------
  // Gutter strips: connector curves + chunk buttons
  // --------------------------------------------------------------------------
  const strip = (side: 'left' | 'right') => {
    const sideEd = side === 'left' ? left.current : right.current
    const resEd = result.current
    if (!sideEd || !resEd) return null
    const lh = sideEd.getOption(monaco.editor.EditorOption.lineHeight)
    const yS = (line: number) => sideEd.getTopForLineNumber(line) - sideEd.getScrollTop()
    const yR = (line: number) => resEd.getTopForLineNumber(line) - resEd.getScrollTop()
    return (
      <div className="relative shrink-0 overflow-hidden border-x border-border-strong bg-panel" style={{ width: STRIP_W }}>
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
          {chunks.map((ch, i) => {
            const b = blockOf(i)
            if (!b) return null
            const lines = side === 'left' ? ch.ours : ch.theirs
            const start = (side === 'left' ? ch.oursStart : ch.theirsStart) + 1
            const s1 = yS(start)
            const s2 = lines.length ? yS(start + lines.length - 1) + lh : s1
            const r1 = yR(b[0])
            const r2 = b[1] > b[0] ? yR(b[1] - 1) + lh : r1
            const [x0, x1] = side === 'left' ? [0, STRIP_W] : [STRIP_W, 0]
            const [a1, a2, c1, c2] = side === 'left' ? [s1, s2, r1, r2] : [r1, r2, s1, s2]
            const [ya1, ya2, yc1, yc2] = side === 'left' ? [a1, a2, c1, c2] : [c1, c2, a1, a2]
            const mid = STRIP_W / 2
            const d = `M${x0},${ya1} C${mid},${ya1} ${mid},${yc1} ${x1},${yc1} L${x1},${yc2} C${mid},${yc2} ${mid},${ya2} ${x0},${ya2} Z`
            return <path key={i} d={d} fill={chunkColor(ch)} stroke={chunkColor(ch)} strokeWidth={1} />
          })}
        </svg>
        {chunks.map((ch, i) => {
          const pending = side === 'left' ? ch.left === 'pending' : ch.right === 'pending'
          if (!pending) return null
          const start = (side === 'left' ? ch.oursStart : ch.theirsStart) + 1
          const top = yS(start)
          if (top < -20 || top > 5000) return null
          return (
            <div key={i} className="absolute flex gap-0.5" style={{ top: Math.max(0, top), [side === 'left' ? 'left' : 'right']: 2 }}>
              <button
                className="rounded bg-bg px-1 text-[11px] font-bold leading-4 text-accent shadow hover:bg-accent hover:text-accent-fg"
                title={side === 'left' ? 'Apply Yours (»)' : 'Apply Theirs («)'}
                data-testid={`apply-${side}-${i}`}
                onClick={() => {
                  setCurrent(i)
                  act([i], side === 'left' ? 'applyLeft' : 'applyRight')
                }}
              >
                {side === 'left' ? '»' : '«'}
              </button>
              <button
                className="rounded bg-bg px-1 text-[11px] leading-4 text-muted shadow hover:text-danger"
                title="Ignore this side's change"
                onClick={() => {
                  setCurrent(i)
                  act([i], side === 'left' ? 'ignoreLeft' : 'ignoreRight')
                }}
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    )
  }

  const cur = current !== null ? chunks[current] : undefined
  const tb = 'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-hover disabled:opacity-40'

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="merge-editor">
      <style>{STYLE}</style>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-strong bg-panel px-2 py-1">
        <span className="mr-2 truncate font-semibold">{path}</span>
        <button className={tb} onClick={() => applyAll((ch) => ch.kind !== 'conflict' && ch.left === 'pending', 'applyLeft')} title="Apply non-conflicting changes from Yours">
          Apply non-conflicting: Yours
        </button>
        <button className={tb} onClick={() => applyAll((ch) => ch.kind !== 'conflict' && ch.right === 'pending', 'applyRight')}>
          Theirs
        </button>
        <button
          className={tb}
          onClick={() => {
            applyAll((ch) => ch.kind !== 'conflict' && ch.left === 'pending', 'applyLeft')
            applyAll((ch) => ch.kind !== 'conflict' && ch.right === 'pending', 'applyRight')
          }}
          data-testid="apply-non-conflicting"
        >
          Both
        </button>
        <span className="mx-1 h-4 w-px bg-border-strong" />
        <button className={tb} onClick={() => applyAll(() => true, 'takeLeft')} data-testid="accept-all-yours">
          Accept all Yours
        </button>
        <button className={tb} onClick={() => applyAll(() => true, 'takeRight')} data-testid="accept-all-theirs">
          Accept all Theirs
        </button>
        <button className={tb} onClick={() => void resetResult()} title="Reset result to original">
          <RotateCcw className="size-3.5" /> Reset
        </button>
        <span className="mx-1 h-4 w-px bg-border-strong" />
        <button className={tb} onClick={() => navigate(-1)} title="Previous conflict (Shift+F7)">
          <ArrowUp className="size-3.5" />
        </button>
        <button className={tb} onClick={() => navigate(1)} title="Next conflict (F7)" data-testid="next-conflict">
          <ArrowDown className="size-3.5" />
        </button>
        {cur && !isResolved(cur) && (
          <span className="flex items-center gap-0.5 rounded bg-hover px-1">
            <button className={tb} onClick={() => act([current!], 'takeLeft')}>
              Accept Left
            </button>
            <button className={tb} onClick={() => act([current!], 'takeRight')}>
              Accept Right
            </button>
            <button className={tb} onClick={() => act([current!], 'bothLR')}>
              Left + Right
            </button>
            <button className={tb} onClick={() => act([current!], 'bothRL')}>
              Right + Left
            </button>
            <button
              className={tb}
              onClick={() => {
                act([current!], 'ignoreLeft')
                act([current!], 'ignoreRight')
              }}
            >
              Ignore
            </button>
          </span>
        )}
        <select className="h-6 rounded border border-border-strong bg-bg text-xs" value={ws} onChange={(e) => void changeWs(e.target.value as typeof ws)} title="Whitespace">
          <option value="none">Compare whitespace</option>
          <option value="trailing">Ignore trailing whitespace</option>
          <option value="all">Ignore all whitespace</option>
        </select>
        <button className={cn(tb, showBase && 'bg-hover text-accent')} onClick={() => setShowBase((b) => !b)} title="Show base version">
          <Eye className="size-3.5" /> Base
        </button>
        <button className={tb} onClick={() => setLayout((l) => (l === 'side' ? 'inline' : 'side'))} title="Side-by-side / inline">
          {layout === 'side' ? <Rows3 className="size-3.5" /> : <Columns3 className="size-3.5" />}
          {layout === 'side' ? 'Inline' : 'Side by side'}
        </button>
        <span className="ml-auto text-xs" data-testid="merge-counter">
          <span className={cn(c.conflicts > 0 ? 'text-danger' : 'text-success')}>
            {c.conflicts} conflict{c.conflicts === 1 ? '' : 's'}
          </span>
          , {c.changes} change{c.changes === 1 ? '' : 's'} remaining
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        {layout === 'side' && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-1 border-b border-border-strong bg-panel px-2 py-0.5 text-xs">
              <span className="truncate">
                <b>Yours:</b> {state.yours.name} <span className="text-muted">({state.yours.detail})</span>
              </span>
              <button className={paneBtn} onClick={() => openFind(left.current)} title="Search in Yours (Ctrl+F)" data-testid="search-left">
                <Search className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Editor path={`merge-left/${path}`} value={v.yours.text} language={language} theme={theme} onMount={onSideMount('left')} options={{ ...EDITOR_OPTIONS, readOnly: true }} />
            </div>
          </div>
        )}
        {layout === 'side' && strip('left')}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-border-strong bg-panel px-2 py-0.5 text-xs">
            <span className="truncate">
              <b>Result</b> <span className="text-muted">(editable — F7 / Shift+F7 to navigate, Ctrl+F search, Ctrl+H replace, Ctrl+Z undoes actions too)</span>
            </span>
            <button className={paneBtn} onClick={() => openFind(result.current)} title="Search in Result (Ctrl+F)" data-testid="search-result">
              <Search className="size-3.5" />
            </button>
            <button className={cn(paneBtn, 'ml-0')} onClick={() => openFind(result.current, true)} title="Replace in Result (Ctrl+H)" data-testid="replace-result">
              <Replace className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <Editor path={`merge-result/${path}`} value={initial} language={language} theme={theme} onMount={onResultMount} options={{ ...EDITOR_OPTIONS, readOnly: false }} />
          </div>
          {showBase && (
            <div className="flex h-48 shrink-0 flex-col border-t border-border-strong">
              <div className="flex items-center gap-1 bg-panel px-2 py-0.5 text-xs">
                <span className="truncate">
                  <b>Base</b> <span className="text-muted">(common ancestor{v.base.exists ? '' : ' — none: both sides added the file'})</span>
                </span>
                <button className={paneBtn} onClick={() => openFind(baseEd.current)} title="Search in Base (Ctrl+F)">
                  <Search className="size-3.5" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <Editor
                  path={`merge-base/${path}`}
                  value={v.base.text}
                  language={language}
                  theme={theme}
                  onMount={(ed) => {
                    baseEd.current = ed
                    const ch = current !== null ? chunks[current] : undefined
                    if (ch) ed.revealLineInCenter(ch.baseStart + 1)
                  }}
                  options={{ ...EDITOR_OPTIONS, readOnly: true }}
                />
              </div>
            </div>
          )}
        </div>
        {layout === 'side' && strip('right')}
        {layout === 'side' && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-1 border-b border-border-strong bg-panel px-2 py-0.5 text-xs">
              <span className="truncate">
                <b>Theirs:</b> {state.theirs.name} <span className="text-muted">({state.theirs.detail})</span>
              </span>
              <button className={paneBtn} onClick={() => openFind(right.current)} title="Search in Theirs (Ctrl+F)" data-testid="search-right">
                <Search className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Editor path={`merge-right/${path}`} value={v.theirs.text} language={language} theme={theme} onMount={onSideMount('right')} options={{ ...EDITOR_OPTIONS, readOnly: true }} />
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border-strong bg-panel px-3 py-2">
        <Button variant="secondary" onClick={() => void close()}>
          <X /> Close
        </Button>
        <Button onClick={() => void save()} data-testid="merge-save">
          Save and Mark Resolved
        </Button>
      </div>
    </div>
  )
}

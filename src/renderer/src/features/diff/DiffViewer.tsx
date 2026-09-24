import { useQuery } from '@tanstack/react-query'
import { DiffEditor } from '@monaco-editor/react'
import { Columns2, Rows2, Space, X } from 'lucide-react'
import type { FileContent } from '@shared/types'
import { WORKTREE, INDEX } from '@shared/types'
import { api } from '@/lib/api'
import { languageForPath } from '@/lib/monaco'
import { cn } from '@/lib/utils'
import { useMonacoTheme } from '@/hooks/usePrefersDark'
import { useAppStore } from '@/stores/app'

export interface DiffSide {
  /** Commit-ish, WORKTREE, INDEX, or null (file does not exist on that side). */
  rev: string | null
  path: string
  label?: string
}

const IMMUTABLE = /^[0-9a-f]{7,64}$/i

/** Loads file content; blobs at commit hashes are immutable and cached forever. */
export function useFileContent(root: string, side: DiffSide) {
  const mutable = side.rev === WORKTREE || side.rev === INDEX || !IMMUTABLE.test(side.rev ?? '')
  return useQuery({
    queryKey: mutable ? ['repo', root, 'file', side.rev, side.path] : ['blob', root, side.rev, side.path],
    queryFn: (): Promise<FileContent> =>
      side.rev === null
        ? Promise.resolve({ exists: false, binary: false, tooLarge: false, size: 0, text: '', encoding: 'utf8' })
        : api.repo.fileContent(root, side.rev, side.path),
    staleTime: mutable ? 0 : Infinity
  })
}

function placeholder(c: FileContent | undefined): string | null {
  if (!c) return null
  if (c.gitlink) return `Submodule commit ${c.gitlink}`
  if (c.binary) return 'Binary file'
  if (c.tooLarge) return `File too large to display (${Math.round(c.size / 1024)} KB)`
  return null
}

interface Props {
  root: string
  left: DiffSide
  right: DiffSide
  title?: string
  onClose?: () => void
  /** Allow editing the right side (working tree); M6 uses it read-only. */
  className?: string
}

/** Monaco side-by-side / unified diff with ignore-whitespace, JetBrains style. */
export function DiffViewer({ root, left, right, title, onClose, className }: Props) {
  const theme = useMonacoTheme()
  const sideBySide = useAppStore((s) => s.settings.diffSideBySide)
  const ignoreWs = useAppStore((s) => s.settings.diffIgnoreWhitespace)
  const update = useAppStore((s) => s.updateSettings)
  const l = useFileContent(root, left)
  const r = useFileContent(root, right)
  const note = placeholder(l.data) ?? placeholder(r.data)
  const path = right.rev ? right.path : left.path

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)} data-testid="diff-viewer">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border-strong bg-panel px-2 text-xs">
        <span className="truncate font-medium" title={path}>
          {title ?? path}
        </span>
        {left.path !== right.path && left.rev && right.rev && (
          <span className="truncate text-muted">
            renamed from {left.path}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            className={cn('rounded p-1 hover:bg-hover', sideBySide && 'bg-hover')}
            title="Side-by-side viewer"
            onClick={() => void update({ diffSideBySide: true })}
          >
            <Columns2 className="size-3.5" />
          </button>
          <button
            className={cn('rounded p-1 hover:bg-hover', !sideBySide && 'bg-hover')}
            title="Unified viewer"
            onClick={() => void update({ diffSideBySide: false })}
          >
            <Rows2 className="size-3.5" />
          </button>
          <button
            className={cn('rounded p-1 hover:bg-hover', ignoreWs && 'bg-hover text-accent')}
            title="Ignore whitespace"
            onClick={() => void update({ diffIgnoreWhitespace: !ignoreWs })}
          >
            <Space className="size-3.5" />
          </button>
          {onClose && (
            <button className="rounded p-1 hover:bg-hover" title="Close diff" onClick={onClose}>
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex h-5 shrink-0 text-[11px] text-muted">
        <div className="flex-1 truncate border-r border-border-strong px-2">{left.label ?? (left.rev ? shortRev(left.rev) : '(does not exist)')}</div>
        <div className="flex-1 truncate px-2">{right.label ?? (right.rev ? shortRev(right.rev) : '(does not exist)')}</div>
      </div>
      <div className="relative min-h-0 flex-1">
        {(l.isError || r.isError) && <div className="p-4 text-danger">{(l.error ?? r.error)?.message}</div>}
        {note ? (
          <div className="flex h-full items-center justify-center text-muted">{note}</div>
        ) : l.data && r.data ? (
          <DiffEditor
            key={`${sideBySide}`}
            original={l.data.text}
            modified={r.data.text}
            language={languageForPath(path)}
            theme={theme}
            options={{
              readOnly: true,
              originalEditable: false,
              renderSideBySide: sideBySide,
              ignoreTrimWhitespace: ignoreWs,
              automaticLayout: true,
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              renderOverviewRuler: true,
              diffWordWrap: 'off',
              hideUnchangedRegions: { enabled: false }
            }}
          />
        ) : (
          <div className="p-4 text-muted">Loading…</div>
        )}
      </div>
    </div>
  )
}

function shortRev(rev: string): string {
  if (rev === WORKTREE) return 'Working tree'
  if (rev === INDEX) return 'Staged (index)'
  if (/^:[123]$/.test(rev)) return ['', 'Base', 'Yours', 'Theirs'][Number(rev[1])]!
  return /^[0-9a-f]{40,64}$/i.test(rev) ? rev.slice(0, 8) : rev
}

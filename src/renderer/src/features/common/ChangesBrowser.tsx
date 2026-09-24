import { useState } from 'react'
import type { FileChange } from '@shared/types'
import { SplitPane } from '@/components/SplitPane'
import { DiffViewer } from '../diff/DiffViewer'
import { FileTree } from './FileTree'

/** File list on the left, diff of the selected file on the right. */
export function ChangesBrowser({
  root,
  files,
  leftRev,
  rightRev,
  leftLabel,
  rightLabel,
  loading
}: {
  root: string
  files: FileChange[]
  /** null = file does not exist on that side for added/deleted files. */
  leftRev: string
  rightRev: string
  leftLabel: string
  rightLabel: string
  loading?: boolean
}) {
  const [sel, setSel] = useState<FileChange | null>(null)
  const [w, setW] = useState(280)
  const current = sel ?? files[0] ?? null
  return (
    <SplitPane direction="horizontal" size={w} onSizeChange={setW} minFirst={180}>
      <div className="h-full overflow-auto py-1">
        {loading && <div className="p-3 text-muted">Loading…</div>}
        {!loading && files.length === 0 && <div className="p-3 text-muted">No differences</div>}
        <FileTree files={files} selected={current?.path ?? null} onSelect={(f) => setSel(f as FileChange)} />
      </div>
      {current ? (
        <DiffViewer
          root={root}
          left={{ rev: current.status === 'A' ? null : leftRev, path: current.oldPath ?? current.path, label: leftLabel }}
          right={{ rev: current.status === 'D' ? null : rightRev, path: current.path, label: rightLabel }}
        />
      ) : (
        <div />
      )}
    </SplitPane>
  )
}

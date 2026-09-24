import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import type { FileStatus } from '@shared/types'
import { cn } from '@/lib/utils'

export interface TreeFile {
  path: string
  oldPath?: string
  status: FileStatus | '?' | string
  additions?: number | null
  deletions?: number | null
}

interface DirNode {
  name: string
  path: string
  dirs: Map<string, DirNode>
  files: TreeFile[]
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  A: { label: 'A', className: 'text-success' },
  M: { label: 'M', className: 'text-accent' },
  D: { label: 'D', className: 'text-muted line-through' },
  R: { label: 'R', className: 'text-[var(--ref-remote)]' },
  C: { label: 'C', className: 'text-[var(--ref-remote)]' },
  T: { label: 'T', className: 'text-warning' },
  U: { label: 'U', className: 'text-danger' },
  '?': { label: '?', className: 'text-muted' }
}

export function statusStyle(status: string) {
  return STATUS_STYLE[status] ?? { label: status, className: 'text-muted' }
}

function buildTree(files: TreeFile[]): DirNode {
  const root: DirNode = { name: '', path: '', dirs: new Map(), files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!
      let next = node.dirs.get(name)
      if (!next) {
        next = { name, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] }
        node.dirs.set(name, next)
      }
      node = next
    }
    node.files.push(f)
  }
  return root
}

/** Collapses chains of single-child folders ("src/main/git") like the IDE. */
function compress(node: DirNode): DirNode {
  let n = node
  while (n.files.length === 0 && n.dirs.size === 1 && n.name !== '') {
    const child = [...n.dirs.values()][0]!
    n = { ...child, name: `${n.name}/${child.name}` }
  }
  return { ...n, dirs: new Map([...n.dirs].map(([k, v]) => [k, compress(v)])) }
}

interface Props {
  files: TreeFile[]
  selected?: string | null
  onSelect?: (file: TreeFile) => void
  onDoubleClick?: (file: TreeFile) => void
  /** Extra controls rendered before the file name (e.g. a staging checkbox). */
  renderPrefix?: (file: TreeFile) => React.ReactNode
  renderSuffix?: (file: TreeFile) => React.ReactNode
  onContextMenu?: (file: TreeFile, e: React.MouseEvent) => void
  flat?: boolean
  className?: string
}

/** Changed-files tree with status letters and +/- counts. */
export function FileTree({ files, selected, onSelect, onDoubleClick, renderPrefix, renderSuffix, onContextMenu, flat, className }: Props) {
  const tree = useMemo(() => compress(buildTree(files)), [files])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const fileRow = (f: TreeFile, depth: number) => {
    const st = statusStyle(f.status)
    const name = flat ? f.path : (f.path.split('/').pop() ?? f.path)
    return (
      <div
        key={f.path}
        data-testid="file-row"
        onClick={() => onSelect?.(f)}
        onDoubleClick={() => onDoubleClick?.(f)}
        onContextMenu={(e) => onContextMenu?.(f, e)}
        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        className={cn('flex h-[22px] cursor-default items-center gap-1.5 pr-2 hover:bg-hover', selected === f.path && 'bg-selected hover:bg-selected')}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {renderPrefix?.(f)}
        <span className={cn('w-3 shrink-0 text-center font-mono text-[11px] font-semibold', st.className)}>{st.label}</span>
        <span className={cn('truncate', f.status === 'D' && 'text-muted line-through')}>{name}</span>
        {f.oldPath && <span className="truncate text-xs text-muted">← {f.oldPath.split('/').pop()}</span>}
        <span className="ml-auto flex shrink-0 gap-1 font-mono text-[11px]">
          {f.additions === null && f.deletions === null ? (
            <span className="text-muted">bin</span>
          ) : (
            <>
              {!!f.additions && <span className="text-success">+{f.additions}</span>}
              {!!f.deletions && <span className="text-danger">−{f.deletions}</span>}
            </>
          )}
          {renderSuffix?.(f)}
        </span>
      </div>
    )
  }

  const dirRow = (d: DirNode, depth: number): React.ReactNode => {
    const isCollapsed = collapsed.has(d.path)
    return (
      <div key={`d:${d.path}`}>
        <div
          className="flex h-[22px] cursor-default items-center gap-1 hover:bg-hover"
          style={{ paddingLeft: 2 + depth * 14 }}
          onClick={() => {
            const next = new Set(collapsed)
            if (isCollapsed) next.delete(d.path)
            else next.add(d.path)
            setCollapsed(next)
          }}
        >
          {isCollapsed ? <ChevronRight className="size-3.5 text-muted" /> : <ChevronDown className="size-3.5 text-muted" />}
          <Folder className="size-3.5 text-muted" />
          <span className="truncate">{d.name}</span>
        </div>
        {!isCollapsed && renderNode(d, depth + 1)}
      </div>
    )
  }

  const renderNode = (n: DirNode, depth: number): React.ReactNode => (
    <>
      {[...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map((d) => dirRow(d, depth))}
      {[...n.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => fileRow(f, depth))}
    </>
  )

  return (
    <div className={cn('select-none text-[13px]', className)} role="tree">
      {flat ? [...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => fileRow(f, 0)) : renderNode(tree, 0)}
    </div>
  )
}

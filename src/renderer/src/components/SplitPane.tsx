import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  direction: 'horizontal' | 'vertical'
  /** Size of the first pane in px. */
  size: number
  onSizeChange?: (size: number) => void
  minFirst?: number
  minSecond?: number
  /** Hide the second pane entirely. */
  collapsed?: boolean
  /** Size applies to the second pane instead of the first. */
  sizeSecond?: boolean
  className?: string
  children: [React.ReactNode, React.ReactNode]
}

/** Resizable two-pane split; the caller persists `size` (per-tab UI state). */
export function SplitPane({ direction, size, onSizeChange, minFirst = 120, minSecond = 120, collapsed, sizeSecond, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const horizontal = direction === 'horizontal'
  const current = drag ?? size

  const start = (e: React.MouseEvent) => {
    e.preventDefault()
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const total = horizontal ? rect.width : rect.height
    let latest = current
    const move = (ev: MouseEvent) => {
      const pos = horizontal ? ev.clientX - rect.left : ev.clientY - rect.top
      const first = Math.max(minFirst, Math.min(total - minSecond, pos))
      latest = sizeSecond ? total - first : first
      setDrag(latest)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      onSizeChange?.(Math.round(latest))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const fixed = { flex: `0 0 ${current}px` }
  return (
    <div ref={ref} className={cn('flex h-full min-h-0 w-full min-w-0', horizontal ? 'flex-row' : 'flex-col', className)}>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={collapsed ? { flex: '1 1 auto' } : sizeSecond ? { flex: '1 1 0' } : fixed}>
        {children[0]}
      </div>
      {!collapsed && (
        <>
          <div
            onMouseDown={start}
            className={cn('shrink-0 bg-border-strong hover:bg-accent', horizontal ? 'w-px cursor-col-resize px-px' : 'h-px cursor-row-resize py-px')}
          />
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={sizeSecond ? fixed : { flex: '1 1 0' }}>
            {children[1]}
          </div>
        </>
      )}
    </div>
  )
}

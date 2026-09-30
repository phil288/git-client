import { useState, type DragEvent } from 'react'
import { Home, Pin, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore, type RepoTab } from '@/stores/tabs'
import { pinnedCount } from '@shared/tabOrder'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { RepoAvatar } from '../welcome/RepoAvatar'

const TAB_DRAG_MIME = 'application/x-gitclient-tab'

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const activate = useTabsStore((s) => s.activate)
  const showWelcome = useTabsStore((s) => s.showWelcome)
  const move = useTabsStore((s) => s.move)
  const [dragId, setDragId] = useState<string | null>(null)
  /** Drop position as "before the tab at this index" (tabs.length = after the last). */
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const pins = pinnedCount(tabs)
  const dragged = dragId ? tabs.find((t) => t.id === dragId) : undefined
  // A tab only moves within its own group (pinned first, then unpinned).
  const accepts = (index: number) => !!dragged && (dragged.pinned ? index <= pins : index >= pins)

  const over = (e: DragEvent, index: number) => {
    if (!dragId) return
    e.stopPropagation()
    if (!accepts(index)) {
      setDropIndex(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropIndex(index)
  }
  const endDrag = () => {
    setDragId(null)
    setDropIndex(null)
  }
  const drop = (e: DragEvent) => {
    if (!dragId) return
    e.preventDefault()
    e.stopPropagation()
    if (dropIndex !== null) move(dragId, dropIndex)
    endDrag()
  }

  return (
    <div
      className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
      role="tablist"
      data-testid="tab-bar"
      // Empty strip space after the tabs drops at the end.
      onDragOver={(e) => over(e, tabs.length)}
      onDrop={drop}
    >
      <button
        className={cn('flex shrink-0 items-center px-2 text-muted hover:bg-hover hover:text-fg', activeId === null && 'text-fg')}
        title="Welcome Screen"
        onClick={showWelcome}
      >
        <Home className="size-4" />
      </button>
      {tabs.map((t, i) => (
        <Tab
          key={t.id}
          tab={t}
          index={i}
          active={t.id === activeId}
          dragging={t.id === dragId}
          dropBefore={dropIndex === i}
          dropAfter={dropIndex === tabs.length && i === tabs.length - 1}
          onActivate={() => activate(t.id)}
          onDragStart={(e) => {
            e.dataTransfer.setData(TAB_DRAG_MIME, t.id)
            e.dataTransfer.effectAllowed = 'move'
            setDragId(t.id)
          }}
          onDragOver={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            over(e, e.clientX < r.left + r.width / 2 ? i : i + 1)
          }}
          onDrop={drop}
          onDragEnd={endDrag}
        />
      ))}
      <button className="flex shrink-0 items-center px-2 text-muted hover:bg-hover hover:text-fg" title="Open another repository" onClick={showWelcome}>
        <Plus className="size-4" />
      </button>
    </div>
  )
}

interface TabProps {
  tab: RepoTab
  index: number
  active: boolean
  dragging: boolean
  dropBefore: boolean
  dropAfter: boolean
  onActivate(): void
  onDragStart(e: DragEvent<HTMLDivElement>): void
  onDragOver(e: DragEvent<HTMLDivElement>): void
  onDrop(e: DragEvent<HTMLDivElement>): void
  onDragEnd(): void
}

function Tab({ tab: t, index: i, active, dragging, dropBefore, dropAfter, onActivate, ...drag }: TabProps) {
  const close = useTabsStore((s) => s.close)
  const closeOthers = useTabsStore((s) => s.closeOthers)
  const closeToRight = useTabsStore((s) => s.closeToRight)
  const setPinned = useTabsStore((s) => s.setPinned)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          data-testid="repo-tab"
          data-pinned={t.pinned ? 'true' : undefined}
          title={`${t.path}${i < 9 ? `  (Ctrl+${i + 1})` : ''}`}
          draggable
          onMouseDown={(e) => {
            if (e.button === 0) onActivate()
          }}
          onAuxClick={(e) => {
            // Pinned tabs are protected from stray middle clicks.
            if (e.button === 1 && !t.pinned) close(t.id)
          }}
          {...drag}
          className={cn(
            'group relative flex min-w-0 max-w-56 shrink-0 cursor-default items-center gap-2 border-r border-border-strong px-3 text-[13px] hover:bg-hover',
            active ? 'bg-bg text-fg' : 'text-muted',
            dragging && 'opacity-50'
          )}
        >
          {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
          {dropBefore && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" data-testid="tab-drop-indicator" />}
          {dropAfter && <span className="absolute inset-y-0 right-0 w-0.5 bg-accent" data-testid="tab-drop-indicator" />}
          <RepoAvatar name={t.name} size={16} className="rounded-[3px]" />
          <span className="truncate">{t.name}</span>
          {t.pinned ? (
            <button
              className="rounded p-0.5 hover:bg-panel-2"
              aria-label={`Unpin ${t.name}`}
              title="Unpin tab"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setPinned(t.id, false)}
            >
              <Pin className="size-3" />
            </button>
          ) : (
            <button
              className="rounded p-0.5 opacity-0 hover:bg-panel-2 group-hover:opacity-100 aria-selected:opacity-100"
              aria-label={`Close ${t.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => close(t.id)}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => setPinned(t.id, !t.pinned)}>{t.pinned ? 'Unpin Tab' : 'Pin Tab'}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => close(t.id)}>Close</ContextMenuItem>
        <ContextMenuItem onSelect={() => closeOthers(t.id)}>Close Other Tabs</ContextMenuItem>
        <ContextMenuItem onSelect={() => closeToRight(t.id)}>Close Tabs to the Right</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

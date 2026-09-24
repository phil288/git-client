import { Home, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/stores/tabs'
import { RepoAvatar } from '../welcome/RepoAvatar'

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const activate = useTabsStore((s) => s.activate)
  const close = useTabsStore((s) => s.close)
  const showWelcome = useTabsStore((s) => s.showWelcome)

  return (
    <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto" role="tablist" data-testid="tab-bar">
      <button
        className={cn('flex shrink-0 items-center px-2 text-muted hover:bg-hover hover:text-fg', activeId === null && 'text-fg')}
        title="Welcome Screen"
        onClick={showWelcome}
      >
        <Home className="size-4" />
      </button>
      {tabs.map((t, i) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          data-testid="repo-tab"
          title={`${t.path}${i < 9 ? `  (Ctrl+${i + 1})` : ''}`}
          onMouseDown={(e) => {
            if (e.button === 0) activate(t.id)
          }}
          onAuxClick={(e) => {
            if (e.button === 1) close(t.id)
          }}
          className={cn(
            'group relative flex min-w-0 max-w-56 shrink-0 cursor-default items-center gap-2 border-r border-border-strong px-3 text-[13px] hover:bg-hover',
            t.id === activeId ? 'bg-bg text-fg' : 'text-muted'
          )}
        >
          {t.id === activeId && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
          <RepoAvatar name={t.name} size={16} className="rounded-[3px]" />
          <span className="truncate">{t.name}</span>
          <button
            className="rounded p-0.5 opacity-0 hover:bg-panel-2 group-hover:opacity-100 aria-selected:opacity-100"
            aria-label={`Close ${t.name}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => close(t.id)}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button className="flex shrink-0 items-center px-2 text-muted hover:bg-hover hover:text-fg" title="Open another repository" onClick={showWelcome}>
        <Plus className="size-4" />
      </button>
    </div>
  )
}

import { useMemo } from 'react'
import { Loader2, SquareTerminal, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useOpsStore } from '@/stores/ops'
import { ProgressBar } from './ProgressBar'

export function StatusBar() {
  // Select the stable map, derive the array locally (a fresh array per selector call loops forever).
  const runningMap = useOpsStore((s) => s.running)
  const running = useMemo(() => Object.values(runningMap), [runningMap])
  const gitStatus = useAppStore((s) => s.gitStatus)
  const showConsole = useAppStore((s) => s.settings.showConsole)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const op = running[running.length - 1]

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border-strong bg-panel px-2 text-xs text-muted" data-testid="status-bar">
      <button
        className={cn('flex items-center gap-1 rounded px-1.5 hover:bg-hover hover:text-fg', showConsole && 'bg-hover text-fg')}
        onClick={() => void updateSettings({ showConsole: !showConsole })}
        title="Git Console (Alt+9)"
      >
        <SquareTerminal className="size-3.5" /> Console
      </button>
      {op && (
        <div className="flex min-w-0 items-center gap-2" data-testid="operation-progress">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          <span className="shrink-0 text-fg">{op.title}</span>
          <ProgressBar percent={op.percent} className="w-32 shrink-0" />
          <span className="truncate">{op.message}</span>
          {op.cancellable && (
            <button className="rounded p-0.5 hover:bg-hover hover:text-fg" title="Cancel" onClick={() => void api.ops.cancel(op.opId)}>
              <X className="size-3.5" />
            </button>
          )}
          {running.length > 1 && <span>+{running.length - 1} more</span>}
        </div>
      )}
      <div className="ml-auto">{gitStatus?.state === 'ok' ? `git ${gitStatus.git.version}` : ''}</div>
    </div>
  )
}

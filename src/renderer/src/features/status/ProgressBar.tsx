import { cn } from '@/lib/utils'

/** Determinate bar when percent is known, animated stripe otherwise. */
export function ProgressBar({ percent, className }: { percent: number | null; className?: string }) {
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-panel-2', className)}>
      {percent === null ? (
        <div className="absolute inset-y-0 w-1/3 animate-[progress-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${Math.max(2, percent)}%` }} />
      )}
      <style>{`@keyframes progress-indeterminate { 0% { left: -33% } 100% { left: 100% } }`}</style>
    </div>
  )
}

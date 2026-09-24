import { cn } from '@/lib/utils'

export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return <kbd className={cn('rounded border border-border-strong bg-panel-2 px-1 font-sans text-[11px] text-muted', className)}>{children}</kbd>
}

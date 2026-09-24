import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/** Subject guide: 50 soft / 72 hard; body lines 72. */
export function messageStats(message: string): { subject: number; longBodyLines: number } {
  const [subject = '', ...body] = message.split('\n')
  return { subject: subject.length, longBodyLines: body.filter((l) => l.length > 72).length }
}

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string
  onValueChange(v: string): void
}

/** Monospace commit message editor with a 72-column ruler and a subject length counter. */
export const CommitMessageEditor = forwardRef<HTMLTextAreaElement, Props>(function CommitMessageEditor({ value, onValueChange, className, ...rest }, ref) {
  const st = messageStats(value)
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <textarea
        ref={ref}
        spellCheck
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="selectable min-h-24 flex-1 resize-none rounded-md border border-border-strong bg-bg p-2 font-mono text-[13px] leading-5 text-fg focus:border-accent focus:outline-none"
        style={{
          // Faint ruler at column 72 (8px padding + 72ch).
          backgroundImage: 'linear-gradient(to right, transparent calc(8px + 72ch), color-mix(in srgb, var(--muted) 35%, transparent) calc(8px + 72ch), transparent calc(8px + 72ch + 1px))'
        }}
        {...rest}
      />
      <div className="mt-1 flex gap-3 text-[11px] text-muted">
        <span className={cn(st.subject > 72 ? 'text-danger' : st.subject > 50 && 'text-warning')} title="Subject line: keep it under 50 characters (72 max)">
          Subject {st.subject}/50
        </span>
        {st.longBodyLines > 0 && <span className="text-warning">{st.longBodyLines} body line(s) over 72 columns</span>}
      </div>
    </div>
  )
})

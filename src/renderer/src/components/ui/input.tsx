import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    spellCheck={false}
    className={cn(
      'h-7 w-full rounded-md border border-border-strong bg-bg px-2 text-[13px] text-fg placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-xs text-muted', className)} {...props} />
}

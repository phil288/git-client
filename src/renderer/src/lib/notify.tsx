import { useState } from 'react'
import { toast } from 'sonner'
import type { ErrorInfo } from '@shared/types'
import { errorInfo } from './api'

function Details({ info }: { info: ErrorInfo }) {
  const [open, setOpen] = useState(false)
  if (!info.stderr && !info.command) return null
  return (
    <div className="mt-1">
      <button className="text-xs text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <pre className="selectable mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-panel-2 p-2 font-mono text-[11px] text-fg">
          {info.command ? `$ ${info.command}\n` : ''}
          {info.stderr}
        </pre>
      )}
    </div>
  )
}

/** Error toast with git's stderr available verbatim in an expandable section. */
export function notifyError(err: unknown, title?: string): void {
  const info = errorInfo(err)
  if (info.code === 'CANCELLED') {
    toast('Cancelled')
    return
  }
  toast.error(title ?? info.message, {
    description: (
      <div>
        {title && <div>{info.message}</div>}
        <Details info={info} />
      </div>
    ),
    duration: 10_000
  })
}

export function notifySuccess(message: string, description?: string): void {
  toast.success(message, { description })
}

/** Wraps an async UI action: errors become toasts instead of unhandled rejections. */
export function run(fn: () => Promise<unknown>, errorTitle?: string): void {
  fn().catch((err) => notifyError(err, errorTitle))
}

import { useEffect, useState } from 'react'
import { useDialogsStore } from '@/stores/dialogs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'

/** Renders the promise-based confirm()/prompt() dialogs from stores/dialogs. */
export function DialogHost() {
  const pending = useDialogsStore((s) => s.pending)
  const settle = useDialogsStore((s) => s.settle)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (pending?.kind === 'prompt') setValue(pending.options.initial ?? '')
    setError(null)
  }, [pending])

  if (!pending) return null

  if (pending.kind === 'choose') {
    const o = pending.options
    return (
      <Dialog open onOpenChange={(open) => !open && settle(null)}>
        <DialogContent className="max-w-lg" data-testid="choose-dialog">
          <DialogHeader>
            <DialogTitle>{o.title}</DialogTitle>
            <DialogDescription asChild>
              <div className="whitespace-pre-wrap">{o.message}</div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            {o.choices
              .filter((c) => c.description)
              .map((c) => (
                <div key={c.id} className="text-xs text-muted">
                  <span className="font-medium text-fg">{c.label}:</span> {c.description}
                </div>
              ))}
          </div>
          <DialogFooter>
            {o.choices.map((c, i) => (
              <Button key={c.id} variant={c.variant ?? (i === 0 ? 'default' : 'secondary')} autoFocus={i === 0} onClick={() => settle(c.id)}>
                {c.label}
              </Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  if (pending.kind === 'confirm') {
    const o = pending.options
    return (
      <Dialog open onOpenChange={(open) => !open && settle(false)}>
        <DialogContent className="max-w-md" data-testid="confirm-dialog">
          <DialogHeader>
            <DialogTitle>{o.title}</DialogTitle>
            <DialogDescription asChild>
              <div className="whitespace-pre-wrap">{o.message}</div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => settle(false)}>
              {o.cancelLabel ?? 'Cancel'}
            </Button>
            <Button variant={o.destructive ? 'danger' : 'default'} autoFocus={!o.destructive} onClick={() => settle(true)}>
              {o.confirmLabel ?? 'OK'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const o = pending.options
  const submit = () => {
    const err = o.validate?.(value) ?? null
    if (err) setError(err)
    else settle(value)
  }
  return (
    <Dialog open onOpenChange={(open) => !open && settle(null)}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{o.title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          {o.label && <Label>{o.label}</Label>}
          <Input autoFocus value={value} placeholder={o.placeholder} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
          {error && <div className="text-xs text-danger">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => settle(null)}>
              Cancel
            </Button>
            <Button type="submit">{o.confirmLabel ?? 'OK'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

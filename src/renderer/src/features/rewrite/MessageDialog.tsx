import { useState } from 'react'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CommitMessageEditor } from '../common/CommitMessageEditor'

interface MessageRequest {
  title: string
  description?: string
  initial: string
  confirmLabel?: string
  resolve(v: string | null): void
}

const useMessageDialog = create<{ req: MessageRequest | null }>(() => ({ req: null }))

/** Multi-line commit message prompt (reword, squash, merge commit). */
export function editMessage(opts: Omit<MessageRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => useMessageDialog.setState({ req: { ...opts, resolve } }))
}

function Inner({ req }: { req: MessageRequest }) {
  const [value, setValue] = useState(req.initial)
  const done = (v: string | null) => {
    useMessageDialog.setState({ req: null })
    req.resolve(v)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && done(null)}>
      <DialogContent className="max-w-2xl" data-testid="message-dialog">
        <DialogHeader>
          <DialogTitle>{req.title}</DialogTitle>
          {req.description && <DialogDescription>{req.description}</DialogDescription>}
        </DialogHeader>
        <CommitMessageEditor
          autoFocus
          className="h-72"
          value={value}
          onValueChange={setValue}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && value.trim()) done(value)
          }}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={() => done(null)}>
            Cancel
          </Button>
          <Button disabled={!value.trim()} onClick={() => done(value)}>
            {req.confirmLabel ?? 'OK'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MessageDialogHost() {
  const req = useMessageDialog((s) => s.req)
  return req ? <Inner key={req.title + req.initial} req={req} /> : null
}

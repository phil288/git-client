import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Commit, Ref, StatusEntry } from '@shared/types'
import { api } from '@/lib/api'
import { attempt, refreshRepo } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { newId } from '@/lib/utils'
import { showBlame, showFileHistory, showRemotes } from '@/lib/views'
import { choose, confirm } from '@/stores/dialogs'
import { closeModal, openModal } from '@/stores/modals'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { tagMenuItems } from '../branches/BranchMenu'
import { changesMenuExtras } from '../changes/ChangesView'
import { commitMenuExtras } from '../log/CommitMenu'
import { gitMenuExtras } from '../repo/RepoToolbar'

const open = { open: true, onOpenChange: (o: boolean) => !o && closeModal() }

export function StashCreateDialog({ root }: { root: string }) {
  const [message, setMessage] = useState('')
  const [untracked, setUntracked] = useState(false)
  const [keepIndex, setKeepIndex] = useState(false)
  return (
    <Dialog {...open}>
      <DialogContent className="max-w-md" data-testid="stash-dialog">
        <DialogHeader>
          <DialogTitle>Stash Changes</DialogTitle>
          <DialogDescription>Save your local changes and revert the working tree to HEAD.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await api.stash.push(root, message, untracked, keepIndex)
              closeModal()
              refreshRepo(root)
              toast.success('Changes stashed')
            } catch (err) {
              notifyError(err, 'Stash failed')
            }
          }}
        >
          <Label>Message (optional)</Label>
          <Input autoFocus value={message} onChange={(e) => setMessage(e.target.value)} />
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={untracked} onCheckedChange={(c) => setUntracked(c === true)} /> Include untracked files
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={keepIndex} onCheckedChange={(c) => setKeepIndex(c === true)} /> Keep staged changes in the index
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit">Stash</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function NewTagDialog({ root, target, label }: { root: string; target: string; label: string }) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [push, setPush] = useState(false)
  const remotes = useQuery({ queryKey: ['repo', root, 'remotes'], queryFn: () => api.remote.list(root) })
  const remote = remotes.data?.[0]?.name
  return (
    <Dialog {...open}>
      <DialogContent className="max-w-md" data-testid="tag-dialog">
        <DialogHeader>
          <DialogTitle>New Tag</DialogTitle>
          <DialogDescription>On {label}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await api.tag.create(root, name.trim(), target, message.trim() ? message : null)
              if (push && remote) await api.tag.push(root, remote, name.trim(), newId())
              closeModal()
              refreshRepo(root)
              toast.success(`Created tag ${name.trim()}${push && remote ? ` and pushed it to ${remote}` : ''}`)
            } catch (err) {
              notifyError(err, 'Could not create the tag')
            }
          }}
        >
          <Label>Tag name</Label>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="v1.2.0" />
          <Label>Message (makes an annotated tag; leave empty for a lightweight tag)</Label>
          <textarea
            className="h-24 rounded-md border border-border-strong bg-bg p-2 font-mono text-[13px] focus:border-accent focus:outline-none"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {remote && (
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={push} onCheckedChange={(c) => setPush(c === true)} /> Push to {remote}
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create Tag
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Menu contributions
// ---------------------------------------------------------------------------

async function pickRemote(root: string): Promise<string | null> {
  const list = await api.remote.list(root)
  if (list.length === 0) {
    notifyError(new Error('This repository has no remotes.'))
    return null
  }
  if (list.length === 1) return list[0]!.name
  return choose({
    title: 'Choose a remote',
    message: 'Which remote should be used?',
    choices: [...list.map((x, i) => ({ id: x.name, label: x.name, variant: i === 0 ? ('default' as const) : ('secondary' as const) })), { id: '', label: 'Cancel', variant: 'secondary' as const }]
  }).then((id) => id || null)
}

tagMenuItems.render = ({ root, r }: { root: string; r: Ref }) =>
  r.kind !== 'tag' ? null : (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() =>
          void attempt(async () => {
            const remote = await pickRemote(root)
            if (!remote) return
            await api.tag.push(root, remote, r.short, newId())
            toast.success(`Pushed tag ${r.short} to ${remote}`)
          }, 'Push failed')
        }
      >
        Push Tag…
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() =>
          void attempt(async () => {
            const ok = await confirm({ title: 'Delete tag', message: `Delete the local tag “${r.short}”?`, confirmLabel: 'Delete', destructive: true })
            if (!ok) return
            await api.tag.delete(root, r.short)
            refreshRepo(root)
          }, 'Delete failed')
        }
      >
        Delete Tag
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() =>
          void attempt(async () => {
            const remote = await pickRemote(root)
            if (!remote) return
            const ok = await confirm({
              title: 'Delete remote tag',
              message: `Delete the tag “${r.short}” on ${remote}? This affects everyone using that remote.`,
              confirmLabel: 'Delete on Remote',
              destructive: true
            })
            if (!ok) return
            await api.tag.deleteRemote(root, remote, r.short, newId())
            toast.success(`Deleted ${r.short} on ${remote}`)
          }, 'Delete failed')
        }
      >
        Delete Tag on Remote…
      </ContextMenuItem>
    </>
  )

commitMenuExtras.newTag = (root: string, c: Commit) => (
  <ContextMenuItem onSelect={() => openModal({ kind: 'newTag', root, target: c.hash, label: `${c.hash.slice(0, 8)} ${c.subject}` })}>New Tag…</ContextMenuItem>
)

changesMenuExtras.items.push((_root: string, e: StatusEntry) =>
  e.untracked ? null : (
    <>
      <ContextMenuItem onSelect={() => showFileHistory(e.path)}>Show History</ContextMenuItem>
      <ContextMenuItem onSelect={() => showBlame(e.path)}>Annotate</ContextMenuItem>
    </>
  )
)

gitMenuExtras.items.push(
  (root) => <DropdownMenuItem onSelect={() => openModal({ kind: 'stashCreate', root })}>Stash Changes…</DropdownMenuItem>,
  () => <DropdownMenuItem onSelect={showRemotes}>Manage Remotes…</DropdownMenuItem>,
  (root) => <DropdownMenuItem onSelect={() => openModal({ kind: 'remote', root })}>Add Remote…</DropdownMenuItem>
)

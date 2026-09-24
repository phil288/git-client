import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Commit, Ref, StatusEntry } from '@shared/types'
import { api } from '@/lib/api'
import { attempt, fetchFlow, refreshRepo } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { newId } from '@/lib/utils'
import { showBlame, showFileHistory } from '@/lib/views'
import { confirm, prompt } from '@/stores/dialogs'
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

export function RemotesDialog({ root }: { root: string }) {
  const q = useQuery({ queryKey: ['repo', root, 'remotes'], queryFn: () => api.remote.list(root) })
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const act = (fn: () => Promise<unknown>) =>
    void attempt(async () => {
      await fn()
      refreshRepo(root)
      void q.refetch()
    })
  return (
    <Dialog {...open}>
      <DialogContent className="max-w-3xl" data-testid="remotes-dialog">
        <DialogHeader>
          <DialogTitle>Manage Remotes</DialogTitle>
        </DialogHeader>
        <div className="max-h-80 overflow-auto rounded border border-border-strong bg-bg">
          {(q.data ?? []).length === 0 && <div className="p-3 text-muted">No remotes</div>}
          {(q.data ?? []).map((r) => (
            <div key={r.name} className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-[13px]">
              <span className="w-24 shrink-0 font-medium">{r.name}</span>
              <span className="min-w-0 flex-1">
                <span className="selectable block truncate font-mono text-xs">{r.fetchUrl}</span>
                {r.pushUrl !== r.fetchUrl && <span className="selectable block truncate font-mono text-xs text-muted">push: {r.pushUrl}</span>}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void fetchFlow(root, r.name)}>
                Fetch
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act(() => api.remotes.prune(root, r.name, newId()))}>
                Prune
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  act(async () => {
                    const u = await prompt({ title: `Edit URL of ${r.name}`, initial: r.fetchUrl, confirmLabel: 'Save' })
                    if (u?.trim()) await api.remotes.setUrl(root, r.name, u.trim(), false)
                  })
                }
              >
                Edit URL
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  act(async () => {
                    const n = await prompt({ title: `Rename remote ${r.name}`, initial: r.name, confirmLabel: 'Rename' })
                    if (n?.trim() && n.trim() !== r.name) await api.remotes.rename(root, r.name, n.trim())
                  })
                }
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() =>
                  act(async () => {
                    const ok = await confirm({
                      title: 'Remove remote',
                      message: `Remove the remote “${r.name}” and its remote-tracking branches? Nothing is deleted on the server.`,
                      confirmLabel: 'Remove',
                      destructive: true
                    })
                    if (ok) await api.remotes.remove(root, r.name)
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            act(async () => {
              await api.remotes.add(root, name.trim(), url.trim())
              setName('')
              setUrl('')
            })
          }}
        >
          <div className="flex w-32 flex-col gap-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="origin" />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or git@…" />
          </div>
          <Button type="submit" disabled={!name.trim() || !url.trim()}>
            Add Remote
          </Button>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => void fetchFlow(root)}>
            Fetch All
          </Button>
          <Button onClick={closeModal}>Close</Button>
        </DialogFooter>
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
  const r = await prompt({ title: 'Remote', label: `One of: ${list.map((x) => x.name).join(', ')}`, initial: list[0]!.name })
  return r?.trim() || null
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
  (root) => <DropdownMenuItem onSelect={() => openModal({ kind: 'remotes', root })}>Manage Remotes…</DropdownMenuItem>
)

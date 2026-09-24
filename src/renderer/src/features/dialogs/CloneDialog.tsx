import { useEffect, useState } from 'react'
import { cloneDirName } from '@shared/display'
import { api, errorInfo } from '@/lib/api'
import { openRepoPath } from '@/lib/repoActions'
import { notifySuccess } from '@/lib/notify'
import { newId } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useOpsStore } from '@/stores/ops'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { ProgressBar } from '../status/ProgressBar'

const PARENT_KEY = 'gitclient.clone.parent'

function joinPath(parent: string, name: string, platform: string): string {
  const sep = platform === 'win32' ? '\\' : '/'
  return parent.endsWith('/') || parent.endsWith('\\') ? parent + name : parent + sep + name
}

export function CloneDialog() {
  const open = useAppStore((s) => s.dialogs.clone)
  const setDialog = useAppStore((s) => s.setDialog)
  const info = useAppStore((s) => s.info)
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [branch, setBranch] = useState('')
  const [opId, setOpId] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; stderr?: string } | null>(null)
  const progress = useOpsStore((s) => (opId ? s.last[opId] : undefined))

  useEffect(() => {
    if (!open) return
    setUrl('')
    setBranch('')
    setName('')
    setNameEdited(false)
    setError(null)
    setOpId(null)
    let stored: string | null = null
    try {
      stored = localStorage.getItem(PARENT_KEY)
    } catch {
      /* storage unavailable */
    }
    setParent(stored ?? info?.homeDir ?? '')
  }, [open, info])

  useEffect(() => {
    if (!nameEdited) setName(cloneDirName(url))
  }, [url, nameEdited])

  const busy = opId !== null && !progress?.done
  const canClone = url.trim() !== '' && parent.trim() !== '' && name.trim() !== '' && !busy

  const start = async () => {
    const id = newId()
    setOpId(id)
    setError(null)
    try {
      localStorage.setItem(PARENT_KEY, parent)
    } catch {
      /* ignore */
    }
    try {
      const root = await api.repo.clone(
        { url: url.trim(), destination: joinPath(parent.trim(), name.trim(), info?.platform ?? 'linux'), branch: branch.trim() || undefined },
        id
      )
      setDialog('clone', false)
      notifySuccess('Repository cloned', root)
      await openRepoPath(root, 'new-tab')
    } catch (err) {
      const e = errorInfo(err)
      setOpId(null)
      if (e.code !== 'CANCELLED') setError({ message: e.message, stderr: e.stderr })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy && opId) void api.ops.cancel(opId)
        setDialog('clone', o)
      }}
    >
      <DialogContent className="max-w-xl" data-testid="clone-dialog">
        <DialogHeader>
          <DialogTitle>Clone Repository</DialogTitle>
          <DialogDescription>Credentials come from your git credential helper or SSH agent; GitClient never stores passwords.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canClone) void start()
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="clone-url">URL</Label>
            <Input id="clone-url" autoFocus disabled={busy} placeholder="https://github.com/owner/repo.git or git@host:owner/repo.git" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="clone-parent">Parent directory</Label>
            <div className="flex gap-2">
              <Input id="clone-parent" disabled={busy} value={parent} onChange={(e) => setParent(e.target.value)} />
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  const p = await api.dialog.pickFolder('Clone into…', parent || undefined)
                  if (p) setParent(p)
                }}
              >
                Browse…
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="clone-name">Folder name</Label>
              <Input
                id="clone-name"
                disabled={busy}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameEdited(true)
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="clone-branch">Branch (optional)</Label>
              <Input id="clone-branch" disabled={busy} placeholder="default branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </div>
          </div>
          {parent && name && <div className="truncate text-xs text-muted">→ {joinPath(parent, name, info?.platform ?? 'linux')}</div>}

          {busy && progress && (
            <div className="flex flex-col gap-1">
              <ProgressBar percent={progress.percent} />
              <div className="truncate font-mono text-[11px] text-muted">{progress.message}</div>
            </div>
          )}
          {error && (
            <div className="rounded border border-danger/50 bg-danger/10 p-2 text-xs">
              <div className="text-danger">{error.message}</div>
              {error.stderr && <pre className="selectable mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{error.stderr}</pre>}
            </div>
          )}

          <DialogFooter>
            {busy ? (
              <Button type="button" variant="secondary" onClick={() => opId && void api.ops.cancel(opId)}>
                Cancel Clone
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={() => setDialog('clone', false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={!canClone}>
              {busy ? 'Cloning…' : 'Clone'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

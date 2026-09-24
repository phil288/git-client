import { useEffect, useMemo, useState } from 'react'
import type { ScanResult } from '@shared/types'
import { shortenHome } from '@shared/display'
import { api, errorInfo } from '@/lib/api'
import { notifyError, notifySuccess } from '@/lib/notify'
import { newId } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useOpsStore } from '@/stores/ops'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { useRecents } from '../welcome/WelcomeScreen'

const NEW_GROUP = '__new__'

export function ScanDialog() {
  const open = useAppStore((s) => s.dialogs.scan)
  const setDialog = useAppStore((s) => s.setDialog)
  const info = useAppStore((s) => s.info)
  const defaultDepth = useAppStore((s) => s.settings.scanMaxDepth)
  const groups = useRecents().data?.groups ?? []

  const [root, setRoot] = useState('')
  const [depth, setDepth] = useState(defaultDepth)
  const [opId, setOpId] = useState<string | null>(null)
  const [results, setResults] = useState<ScanResult[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [groupChoice, setGroupChoice] = useState<string>('')
  const [newGroupName, setNewGroupName] = useState('')
  const progress = useOpsStore((s) => (opId ? s.running[opId] : undefined))

  useEffect(() => {
    if (!open) return
    setRoot(info?.homeDir ?? '')
    setDepth(defaultDepth)
    setResults(null)
    setSelected(new Set())
    setGroupChoice('')
    setNewGroupName('')
    setOpId(null)
  }, [open, info, defaultDepth])

  const scanning = opId !== null
  const selectable = useMemo(() => (results ?? []).filter((r) => !r.alreadyInRecents), [results])

  const scan = async () => {
    const id = newId()
    setOpId(id)
    setResults(null)
    try {
      const found = await api.scan.start(root, depth, id)
      setResults(found)
      setSelected(new Set(found.filter((r) => !r.alreadyInRecents).map((r) => r.path)))
    } catch (err) {
      if (errorInfo(err).code !== 'CANCELLED') notifyError(err, 'Scan failed')
    } finally {
      setOpId(null)
    }
  }

  const add = async () => {
    try {
      let groupId: string | null = groupChoice || null
      if (groupChoice === NEW_GROUP) groupId = newGroupName.trim() ? (await api.groups.create(newGroupName)).id : null
      await api.recents.addMany([...selected], groupId)
      notifySuccess(`Added ${selected.size} repositor${selected.size === 1 ? 'y' : 'ies'}`)
      setDialog('scan', false)
    } catch (err) {
      notifyError(err)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && opId) void api.ops.cancel(opId)
        setDialog('scan', o)
      }}
    >
      <DialogContent className="max-w-2xl" data-testid="scan-dialog">
        <DialogHeader>
          <DialogTitle>Scan Folder for Repositories</DialogTitle>
          <DialogDescription>Skips node_modules, .venv, vendor, build/dist/out/target and other generated folders.</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="scan-root">Folder</Label>
            <Input id="scan-root" value={root} disabled={scanning} onChange={(e) => setRoot(e.target.value)} />
          </div>
          <Button
            variant="secondary"
            disabled={scanning}
            onClick={async () => {
              const p = await api.dialog.pickFolder('Folder to scan', root || undefined)
              if (p) setRoot(p)
            }}
          >
            Browse…
          </Button>
          <div className="flex w-24 flex-col gap-1">
            <Label htmlFor="scan-depth">Max depth</Label>
            <Input id="scan-depth" type="number" min={0} max={12} value={depth} disabled={scanning} onChange={(e) => setDepth(Number(e.target.value))} />
          </div>
          {scanning ? (
            <Button variant="secondary" onClick={() => opId && void api.ops.cancel(opId)}>
              Cancel
            </Button>
          ) : (
            <Button disabled={!root.trim()} onClick={() => void scan()}>
              Scan
            </Button>
          )}
        </div>

        {scanning && <div className="truncate text-xs text-muted">{progress?.message ?? 'Scanning…'}</div>}

        {results && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>
                Found {results.length} repositor{results.length === 1 ? 'y' : 'ies'}
                {results.length !== selectable.length && ` (${results.length - selectable.length} already in Recents)`}
              </span>
              <button className="ml-auto text-accent hover:underline" onClick={() => setSelected(new Set(selectable.map((r) => r.path)))}>
                Select all
              </button>
              <button className="text-accent hover:underline" onClick={() => setSelected(new Set())}>
                Select none
              </button>
            </div>
            <div className="max-h-72 min-h-24 overflow-y-auto rounded border border-border-strong bg-bg p-1">
              {results.length === 0 && <div className="p-2 text-muted">No repositories found.</div>}
              {results.map((r) => (
                <label key={r.path} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-hover">
                  <Checkbox
                    disabled={r.alreadyInRecents}
                    checked={r.alreadyInRecents || selected.has(r.path)}
                    onCheckedChange={(c) => {
                      const next = new Set(selected)
                      if (c === true) next.add(r.path)
                      else next.delete(r.path)
                      setSelected(next)
                    }}
                  />
                  <span className="font-medium">{r.name}</span>
                  <span className="truncate text-xs text-muted">{info ? shortenHome(r.path, info.homeDir, info.platform) : r.path}</span>
                  {r.alreadyInRecents && <span className="ml-auto shrink-0 text-xs text-muted">already added</span>}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="scan-group">Add to group</Label>
              <select
                id="scan-group"
                className="h-7 rounded-md border border-border-strong bg-bg px-2 text-[13px]"
                value={groupChoice}
                onChange={(e) => setGroupChoice(e.target.value)}
              >
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value={NEW_GROUP}>New group…</option>
              </select>
              {groupChoice === NEW_GROUP && <Input className="w-48" placeholder="Group name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => setDialog('scan', false)}>
            Close
          </Button>
          <Button disabled={!results || selected.size === 0} onClick={() => void add()}>
            Add {selected.size > 0 ? selected.size : ''} to Recents
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

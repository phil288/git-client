import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Info, Loader2, PlugZap } from 'lucide-react'
import type { ErrorInfo, Remote, RemoteTestResult } from '@shared/types'
import { remoteNameError, suggestRemoteName, urlHint } from '@shared/remotes'
import { api, errorInfo } from '@/lib/api'
import { fetchFlow, refreshRepo } from '@/lib/gitOps'
import { cn, newId } from '@/lib/utils'
import { closeModal } from '@/stores/modals'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { describeTest, useRemotes } from './remoteFlows'

type TestState = { kind: 'idle' } | { kind: 'running'; opId: string } | { kind: 'ok'; result: RemoteTestResult } | { kind: 'error'; error: ErrorInfo }

function Hint({ tone, children, testId }: { tone: 'info' | 'warning' | 'danger' | 'success'; children: React.ReactNode; testId?: string }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 text-xs',
        tone === 'info' && 'text-muted',
        tone === 'warning' && 'text-warning',
        tone === 'danger' && 'text-danger',
        tone === 'success' && 'text-success'
      )}
      data-testid={testId}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

/** Add a remote (`remote` undefined) or edit one: name, fetch URL, optional push URL, with a connection test. */
export function RemoteDialog({ root, remote }: { root: string; remote?: Remote }) {
  const editing = !!remote
  const list = useRemotes(root)
  const others = (list.data ?? []).map((r) => r.name).filter((n) => n !== remote?.name)
  const [name, setName] = useState(remote?.name ?? suggestRemoteName(others))
  const nameTouched = useRef(editing)
  const [url, setUrl] = useState(remote?.fetchUrl ?? '')
  const [separatePush, setSeparatePush] = useState(!!remote && remote.pushUrl !== remote.fetchUrl)
  const [pushUrl, setPushUrl] = useState(remote && remote.pushUrl !== remote.fetchUrl ? remote.pushUrl : '')
  const [fetchAfter, setFetchAfter] = useState(true)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ErrorInfo | null>(null)

  const nameErr = remoteNameError(name, others)
  const hint = urlHint(url)
  const pushHint = separatePush ? urlHint(pushUrl) : null
  const pushMissing = separatePush && !pushUrl.trim()
  const unchanged =
    editing && name.trim() === remote.name && url.trim() === remote.fetchUrl && (separatePush ? pushUrl.trim() : remote.fetchUrl) === remote.pushUrl
  const canSave = !nameErr && !!url.trim() && !pushMissing && !saving && !unchanged

  const cancelTest = () => {
    if (test.kind === 'running') void api.ops.cancel(test.opId)
  }
  const onUrl = (v: string) => {
    cancelTest()
    setUrl(v)
    setTest({ kind: 'idle' })
    setError(null)
    if (!nameTouched.current) setName(suggestRemoteName(others, v))
  }
  const runTest = async () => {
    const opId = newId()
    setTest({ kind: 'running', opId })
    try {
      const result = await api.remotes.test(root, url.trim(), opId)
      setTest((t) => (t.kind === 'running' && t.opId === opId ? { kind: 'ok', result } : t))
    } catch (err) {
      setTest((t) => (t.kind === 'running' && t.opId === opId ? { kind: 'error', error: errorInfo(err) } : t))
    }
  }
  const close = () => {
    cancelTest()
    closeModal()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    const n = name.trim()
    const push = separatePush ? pushUrl.trim() : null
    try {
      if (editing) {
        await api.remotes.update(root, remote.name, { name: n, fetchUrl: url.trim(), pushUrl: push })
        toast.success(n === remote.name ? `Saved remote ${n}` : `Renamed ${remote.name} to ${n}`)
      } else {
        await api.remotes.add(root, n, url.trim(), push)
        toast.success(`Added remote ${n}`)
      }
      cancelTest()
      closeModal()
      refreshRepo(root)
      if (!editing && fetchAfter) void fetchFlow(root, n)
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg" data-testid="remote-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit Remote ${remote.name}` : 'Add Remote'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Change where this repository fetches from and pushes to.'
              : 'Connect this repository to a copy hosted elsewhere (GitHub, GitLab, a server or a folder). The main one is usually called origin.'}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="remote-url">URL</Label>
            <Input
              id="remote-url"
              autoFocus={!editing}
              value={url}
              onChange={(e) => onUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git or git@github.com:owner/repo.git"
              data-testid="remote-url"
            />
            {hint && (
              <Hint tone={hint.tone} testId="remote-url-hint">
                {hint.text}
              </Hint>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="remote-name">Name</Label>
            <Input
              id="remote-name"
              autoFocus={editing}
              value={name}
              onChange={(e) => {
                nameTouched.current = true
                setName(e.target.value)
                setError(null)
              }}
              placeholder="origin"
              className="max-w-56"
              data-testid="remote-name"
            />
            {name !== '' && nameErr ? (
              <Hint tone="danger" testId="remote-name-error">
                {nameErr}
              </Hint>
            ) : editing && name.trim() !== remote.name ? (
              <Hint tone="info">Its remote-tracking branches are renamed and local branches keep tracking them.</Hint>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={separatePush} onCheckedChange={(c) => setSeparatePush(c === true)} data-testid="remote-separate-push" />
              Use a different URL for pushing
            </label>
            {separatePush && (
              <>
                <Input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="Push URL" aria-label="Push URL" data-testid="remote-push-url" />
                {pushHint && <Hint tone={pushHint.tone}>{pushHint.text}</Hint>}
              </>
            )}
          </div>
          {!editing && (
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox checked={fetchAfter} onCheckedChange={(c) => setFetchAfter(c === true)} data-testid="remote-fetch-after" />
              Fetch its branches after adding
            </label>
          )}

          <div className="flex min-h-7 items-center gap-2 rounded-md border border-border bg-panel px-2 py-1.5" data-testid="remote-test">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!url.trim()}
              onClick={() => (test.kind === 'running' ? cancelTest() : void runTest())}
              data-testid="remote-test-button"
            >
              {test.kind === 'running' ? <Loader2 className="animate-spin" /> : <PlugZap />}
              {test.kind === 'running' ? 'Cancel' : 'Test Connection'}
            </Button>
            <div className="min-w-0 flex-1" data-testid="remote-test-result" data-state={test.kind}>
              {test.kind === 'idle' && <span className="text-xs text-muted">Checks the URL is reachable. Nothing is downloaded.</span>}
              {test.kind === 'running' && <span className="text-xs text-muted">Connecting…</span>}
              {test.kind === 'ok' && <Hint tone="success">{describeTest(test.result)}</Hint>}
              {test.kind === 'error' && (
                <Hint tone="danger">
                  <span title={test.error.stderr}>{(test.error.stderr?.trim().split('\n').find((l) => l.startsWith('fatal:') || l.startsWith('ERROR')) ?? test.error.message).replace(/^fatal:\s*/, '')}</span>
                </Hint>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger" data-testid="remote-error">
              <div className="font-medium">{error.message}</div>
              {error.stderr && <pre className="mt-1 whitespace-pre-wrap font-mono">{error.stderr.trim()}</pre>}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave} data-testid="remote-save">
              {saving && <Loader2 className="animate-spin" />}
              {editing ? 'Save' : 'Add Remote'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

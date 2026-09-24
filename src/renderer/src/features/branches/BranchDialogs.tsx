import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Commit, MergeMode, Ref } from '@shared/types'
import { WORKTREE } from '@shared/types'
import { api, ApiError, errorInfo } from '@/lib/api'
import { checkoutFlow, mergeFlow, refreshRepo, reportOutcome } from '@/lib/gitOps'
import { formatDate, shortHash } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { cn, newId } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { confirm } from '@/stores/dialogs'
import { closeModal } from '@/stores/modals'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { ChangesBrowser } from '../common/ChangesBrowser'
import { useRefs } from '../log/LogView'

function useOpen() {
  return { open: true, onOpenChange: (o: boolean) => !o && closeModal() }
}

export function NewBranchDialog({ root, start, startLabel }: { root: string; start: string; startLabel: string }) {
  const [name, setName] = useState('')
  const [checkout, setCheckout] = useState(true)
  const [valid, setValid] = useState<boolean | null>(null)
  useEffect(() => {
    if (!name.trim()) return setValid(null)
    const t = setTimeout(() => void api.branch.checkName(root, name.trim()).then(setValid), 200)
    return () => clearTimeout(t)
  }, [name, root])

  const submit = async () => {
    try {
      await api.branch.create(root, name.trim(), start, checkout)
      closeModal()
      refreshRepo(root)
      toast.success(checkout ? `Created and checked out ${name.trim()}` : `Created ${name.trim()}`)
    } catch (err) {
      if (err instanceof ApiError && err.info.code === 'LOCAL_CHANGES') {
        // Create without checkout, then run the normal checkout flow (Smart/Force).
        try {
          await api.branch.create(root, name.trim(), start, false)
          closeModal()
          await checkoutFlow(root, { kind: 'local', name: name.trim() })
        } catch (e) {
          notifyError(e)
        }
      } else notifyError(err, 'Could not create the branch')
    }
  }

  return (
    <Dialog {...useOpen()}>
      <DialogContent className="max-w-md" data-testid="new-branch-dialog">
        <DialogHeader>
          <DialogTitle>Create New Branch</DialogTitle>
          <DialogDescription>From {startLabel}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) void submit()
          }}
        >
          <Label htmlFor="nb-name">New branch name</Label>
          <Input id="nb-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/my-change" />
          {valid === false && <div className="text-xs text-danger">Not a valid branch name.</div>}
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={checkout} onCheckedChange={(c) => setCheckout(c === true)} /> Checkout branch
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RenameBranchDialog({ root, branch }: { root: string; branch: Ref }) {
  const [name, setName] = useState(branch.short)
  const [remote, setRemote] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api.branch.rename(root, branch.short, name.trim(), remote, newId())
      closeModal()
      refreshRepo(root)
      toast.success(`Renamed ${branch.short} to ${name.trim()}${remote ? ' (also on the remote)' : ''}`)
    } catch (err) {
      notifyError(err, 'Rename failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog {...useOpen()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Branch ‘{branch.short}’</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && name.trim() !== branch.short) void submit()
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
          {branch.upstream && (
            <label className="flex items-start gap-2 text-[13px]">
              <Checkbox className="mt-0.5" checked={remote} onCheckedChange={(c) => setRemote(c === true)} />
              <span>
                Also rename on the remote ({branch.upstream})
                <span className="block text-xs text-muted">Pushes the new name, deletes the old remote branch and updates the upstream.</span>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || name.trim() === branch.short}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const MERGE_OPTIONS: { mode: MergeMode; label: string; help: string }[] = [
  { mode: 'default', label: 'Default', help: 'Fast-forward when possible, otherwise create a merge commit.' },
  { mode: 'no-ff', label: '--no-ff', help: 'Always create a merge commit.' },
  { mode: 'ff-only', label: '--ff-only', help: 'Only fast-forward; refuse when histories diverged.' },
  { mode: 'squash', label: '--squash', help: 'Apply all changes as staged changes, without a merge commit (commit them yourself).' }
]

/** Hook for M8's conflict preview (git merge-tree). */
export const mergePreview: { render?: (p: { root: string; ref: string }) => React.ReactNode } = {}

export function MergeDialog({ root, ref, label, current }: { root: string; ref: string; label: string; current: string | null }) {
  const [mode, setMode] = useState<MergeMode>('default')
  return (
    <Dialog {...useOpen()}>
      <DialogContent className="max-w-md" data-testid="merge-dialog">
        <DialogHeader>
          <DialogTitle>
            Merge ‘{label}’ into ‘{current ?? 'HEAD'}’
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {MERGE_OPTIONS.map((o) => (
            <label key={o.mode} className="flex cursor-pointer items-start gap-2 rounded p-1 hover:bg-hover">
              <input type="radio" className="mt-1" checked={mode === o.mode} onChange={() => setMode(o.mode)} />
              <span>
                <span className="font-mono text-[13px]">{o.label}</span>
                <span className="block text-xs text-muted">{o.help}</span>
              </span>
            </label>
          ))}
          {mergePreview.render?.({ root, ref })}
          <div className="text-xs text-muted">A backup of the current branch is saved first; you can undo the merge afterwards.</div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              closeModal()
              void mergeFlow(root, ref, mode)
            }}
          >
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CommitList({ commits, empty }: { commits: Commit[]; empty: string }) {
  if (commits.length === 0) return <div className="p-3 text-muted">{empty}</div>
  return (
    <div className="py-1">
      {commits.map((c) => (
        <div key={c.hash} className="flex gap-2 px-3 py-0.5 text-[13px] hover:bg-hover">
          <span className="font-mono text-xs text-muted">{shortHash(c.hash)}</span>
          <span className="truncate">{c.subject}</span>
          <span className="ml-auto shrink-0 text-xs text-muted">
            {c.authorName}, {formatDate(c.authorTime)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function CompareDialog({ root, a, aLabel, b, bLabel }: { root: string; a: string; aLabel: string; b: string; bLabel: string }) {
  const [tab, setTab] = useState<'a' | 'b' | 'files'>('a')
  const q = useQuery({ queryKey: ['repo', root, 'compare', a, b], queryFn: () => api.branch.compare(root, a, b) })
  const tabs = [
    { id: 'a' as const, label: `In ‘${aLabel}’ but not ‘${bLabel}’ (${q.data?.onlyA.length ?? '…'})` },
    { id: 'b' as const, label: `In ‘${bLabel}’ but not ‘${aLabel}’ (${q.data?.onlyB.length ?? '…'})` },
    { id: 'files' as const, label: `Files (${q.data?.files.length ?? '…'})` }
  ]
  return (
    <Dialog {...useOpen()}>
      <DialogContent className="h-[80vh] max-w-6xl" data-testid="compare-dialog">
        <DialogHeader>
          <DialogTitle>
            Compare ‘{aLabel}’ with ‘{bLabel}’
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-1 border-b border-border-strong">
          {tabs.map((t) => (
            <button key={t.id} className={cn('px-3 py-1 text-[13px]', tab === t.id ? 'border-b-2 border-accent font-medium' : 'text-muted')} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded border border-border-strong bg-bg">
          {q.isError && <div className="p-3 text-danger">{q.error.message}</div>}
          {q.data && tab === 'a' && <CommitList commits={q.data.onlyA} empty="Nothing" />}
          {q.data && tab === 'b' && <CommitList commits={q.data.onlyB} empty="Nothing" />}
          {tab === 'files' && <ChangesBrowser root={root} files={q.data?.files ?? []} leftRev={b} rightRev={a} leftLabel={bLabel} rightLabel={aLabel} loading={q.isLoading} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function WorktreeDiffDialog({ root, rev, label }: { root: string; rev: string; label: string }) {
  const q = useQuery({ queryKey: ['repo', root, 'vsWorktree', rev], queryFn: () => api.repo.changesVsWorktree(root, rev) })
  return (
    <Dialog {...useOpen()}>
      <DialogContent className="h-[80vh] max-w-6xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Diff between ‘{label}’ and the working tree</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded border border-border-strong bg-bg">
          <ChangesBrowser root={root} files={q.data ?? []} leftRev={rev} rightRev={WORKTREE} leftLabel={label} rightLabel="Working tree" loading={q.isLoading} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function UpstreamDialog({ root, branch }: { root: string; branch: string }) {
  const refs = useRefs(root)
  const remotes = (refs.data ?? []).filter((r) => r.kind === 'remote')
  const current = (refs.data ?? []).find((r) => r.kind === 'local' && r.short === branch)?.upstream
  const [value, setValue] = useState<string>('')
  useEffect(() => {
    if (!value && (current || remotes[0])) setValue(current ?? remotes.find((r) => r.short.endsWith(`/${branch}`))?.short ?? remotes[0]!.short)
  }, [current, remotes, branch, value])
  return (
    <Dialog {...useOpen()}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Set Upstream for ‘{branch}’</DialogTitle>
        </DialogHeader>
        {remotes.length === 0 ? (
          <div className="text-muted">No remote branches. Push the branch first (Push… sets the upstream).</div>
        ) : (
          <select className="h-7 rounded-md border border-border-strong bg-bg px-2 text-[13px]" value={value} onChange={(e) => setValue(e.target.value)}>
            {remotes.map((r) => (
              <option key={r.name} value={r.short}>
                {r.short}
              </option>
            ))}
          </select>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            disabled={!value}
            onClick={async () => {
              try {
                await api.branch.setUpstream(root, branch, value)
                closeModal()
                refreshRepo(root)
                toast.success(`${branch} now tracks ${value}`)
              } catch (err) {
                notifyError(err)
              }
            }}
          >
            Set Upstream
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Push dialog: outgoing commits, remote/branch target, tags, --force-with-lease only. */
export function PushDialog({ root, branch: initial }: { root: string; branch?: string }) {
  const refs = useRefs(root)
  const remotesQ = useQuery({ queryKey: ['repo', root, 'remotes'], queryFn: () => api.remote.list(root) })
  const confirmPush = useAppStore((s) => s.settings.confirmPush)
  const locals = (refs.data ?? []).filter((r) => r.kind === 'local')
  const head = locals.find((r) => r.isHead)
  const [branch, setBranch] = useState(initial ?? head?.short ?? '')
  const local = locals.find((r) => r.short === branch)
  const upstream = local?.upstream
  const remotes = remotesQ.data ?? []
  const [remote, setRemote] = useState('')
  const [remoteBranch, setRemoteBranch] = useState('')
  const [tags, setTags] = useState(false)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!branch && head) setBranch(head.short)
  }, [head, branch])
  // (Re)initialise the target when the branch or its upstream changes — not on every render,
  // so manual edits of the remote branch name stick.
  const remoteList = remotesQ.data
  useEffect(() => {
    const list = remoteList ?? []
    if (upstream) {
      const rn = list.find((r) => upstream.startsWith(r.name + '/'))?.name
      if (rn) {
        setRemote(rn)
        setRemoteBranch(upstream.slice(rn.length + 1))
        return
      }
    }
    if (list[0]) {
      setRemote((r) => r || list[0]!.name)
      setRemoteBranch(branch)
    }
  }, [upstream, remoteList, branch])

  const outgoing = useQuery({
    queryKey: ['repo', root, 'outgoing', branch, remote, remoteBranch],
    queryFn: () => api.remote.outgoing(root, branch, remote, remoteBranch),
    enabled: !!(branch && remote && remoteBranch)
  })
  const behind = local?.behind ?? 0
  const list = useMemo(() => outgoing.data ?? [], [outgoing.data])

  const doPush = async () => {
    if (force) {
      const ok = await confirm({
        title: 'Force push',
        message: `Force-push ${branch} to ${remote}/${remoteBranch}? This rewrites the remote branch. GitClient only uses --force-with-lease: it refuses if the remote has commits you have not fetched.`,
        confirmLabel: 'Force Push',
        destructive: true
      })
      if (!ok) return
    } else if (confirmPush && list.length > 20) {
      const ok = await confirm({ title: 'Push', message: `Push ${list.length} commits to ${remote}/${remoteBranch}?`, confirmLabel: 'Push' })
      if (!ok) return
    }
    setBusy(true)
    try {
      await api.remote.push(root, { remote, branch, remoteBranch, setUpstream: !upstream, forceWithLease: force, tags }, newId())
      closeModal()
      reportOutcome(root, { status: 'ok', message: `Pushed ${branch} to ${remote}/${remoteBranch}` })
    } catch (err) {
      const info = errorInfo(err)
      if (info.code !== 'CANCELLED') notifyError(err, /rejected|non-fast-forward|stale info/i.test(info.stderr ?? '') ? 'Push rejected — fetch/pull first, or force push' : 'Push failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog {...useOpen()}>
      <DialogContent className="max-w-2xl" data-testid="push-dialog">
        <DialogHeader>
          <DialogTitle>Push Commits</DialogTitle>
          <DialogDescription>Credentials come from your git credential helper or SSH agent.</DialogDescription>
        </DialogHeader>
        {remotes.length === 0 && !remotesQ.isLoading ? (
          <div className="text-muted">This repository has no remotes. Add one in Git → Manage Remotes.</div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[13px]">
              <select className="h-7 rounded-md border border-border-strong bg-bg px-2" value={branch} onChange={(e) => setBranch(e.target.value)}>
                {locals.map((r) => (
                  <option key={r.name} value={r.short}>
                    {r.short}
                  </option>
                ))}
              </select>
              →
              <select className="h-7 rounded-md border border-border-strong bg-bg px-2" value={remote} onChange={(e) => setRemote(e.target.value)}>
                {remotes.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
              :
              <Input className="w-64" value={remoteBranch} onChange={(e) => setRemoteBranch(e.target.value)} />
              {!upstream && <span className="text-xs text-muted">(new, sets upstream)</span>}
            </div>
            <div className="max-h-72 min-h-24 overflow-auto rounded border border-border-strong bg-bg">
              {outgoing.isLoading && <div className="p-3 text-muted">Loading…</div>}
              {outgoing.data && <CommitList commits={list} empty="Nothing to push" />}
            </div>
            {behind > 0 && !force && (
              <div className="text-xs text-warning">
                {branch} is {behind} commit{behind === 1 ? '' : 's'} behind its upstream: the push will be rejected unless you pull first.
              </div>
            )}
            <div className="flex gap-4 text-[13px]">
              <label className="flex items-center gap-2">
                <Checkbox checked={tags} onCheckedChange={(c) => setTags(c === true)} /> Push tags
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={force} onCheckedChange={(c) => setForce(c === true)} />
                <span className={cn(force && 'text-danger')}>Force push (--force-with-lease)</span>
              </label>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant={force ? 'danger' : 'default'} disabled={busy || !remote || !remoteBranch || !branch} onClick={() => void doPush()}>
            {busy ? 'Pushing…' : force ? 'Force Push' : 'Push'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

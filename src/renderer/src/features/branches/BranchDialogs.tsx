import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeftRight } from 'lucide-react'
import type { Commit, MergeMode, Ref } from '@shared/types'
import { WORKTREE } from '@shared/types'
import { api, ApiError, errorInfo } from '@/lib/api'
import { checkoutFlow, mergeBranchFlow, refreshRepo, reportOutcome } from '@/lib/gitOps'
import { formatDate, shortHash } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { cn, newId } from '@/lib/utils'
import { showInLog } from '@/lib/views'
import { useAppStore } from '@/stores/app'
import { confirm } from '@/stores/dialogs'
import { useEpoch } from '@/stores/repoEpoch'
import { closeModal } from '@/stores/modals'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { ChangesBrowser } from '../common/ChangesBrowser'
import { RefSelect, type RefChoice } from '../common/RefSelect'
import { useRefs } from '../log/LogView'
import { useChangedCount } from '../worktrees/WorktreeDialogs'

const selectCls = 'h-7 rounded-md border border-border-strong bg-bg px-2 text-[13px]'

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

/** Hook for M8's conflict preview (git merge-tree); `into` null = HEAD. */
export const mergePreview: { render?: (p: { root: string; ref: string; into: string | null }) => React.ReactNode } = {}

/** Preflight of merging `source` into local branch `target`; null while unknown. */
export function useMergePlan(root: string, source: string, target: string | null) {
  return useQuery({
    queryKey: ['repo', root, 'mergePlan', source, target],
    queryFn: () => api.branch.mergePlan(root, source, target!),
    enabled: !!source && !!target
  }).data ?? null
}

const DETACHED = ''

/**
 * Merge any branch, remote branch, tag or commit into any local branch (the
 * current one by default). Runs where the target is checked out.
 */
export function MergeDialog({ root, source: source0, sourceLabel, target: target0 }: { root: string; source?: string; sourceLabel?: string; target?: string }) {
  const info = useQuery({ queryKey: ['repo', root, 'info'], queryFn: () => api.repo.info(root) })
  const refs = useRefs(root)
  const current = info.data?.branch ?? null
  const locals = (refs.data ?? []).filter((r) => r.kind === 'local').map((r) => r.short)
  const [source, setSource] = useState<RefChoice>({ rev: source0 ?? '', label: sourceLabel ?? (source0 ? source0.replace(/^refs\/(heads|remotes|tags)\//, '') : 'Choose…') })
  const [picked, setPicked] = useState<string | null>(target0 ?? null)
  const [mode, setMode] = useState<MergeMode>('default')
  // '' (DETACHED) = merge into a detached HEAD.
  const target = picked ?? current ?? DETACHED
  const into = target === DETACHED ? null : target
  const plan = useMergePlan(root, source.rev, into)
  const changed = useChangedCount(plan?.host ?? root, !into || !!plan?.host)
  const ahead = into ? (plan?.ahead ?? null) : null
  const same = !!into && (source.rev === into || source.rev === `refs/heads/${into}`)
  const needsCheckout = !!plan && !plan.host && (!plan.canFastForward || mode === 'no-ff' || mode === 'squash')
  const squashOk = !into || (plan?.isCurrent ?? into === current)
  const effMode = mode === 'squash' && !squashOk ? 'default' : mode

  return (
    <Dialog {...useOpen()}>
      <DialogContent className="max-w-lg" data-testid="merge-dialog">
        <DialogHeader>
          <DialogTitle>
            Merge ‘{source.rev ? source.label : '…'}’ into ‘{into ?? 'HEAD'}’
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
            <Label>Merge</Label>
            <RefSelect root={root} value={source} onChange={setSource} headLabel={current} testId="merge-source" />
            <Label htmlFor="merge-target">Into</Label>
            <select id="merge-target" className={selectCls} value={target} onChange={(e) => setPicked(e.target.value)} data-testid="merge-target">
              {current === null && <option value={DETACHED}>HEAD (detached)</option>}
              {locals.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {b === current ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>
          {plan && ahead !== 0 && (
            <div className="text-xs text-muted" data-testid="merge-where">
              {plan.isCurrent ? (
                <>Runs here, in the current working tree.</>
              ) : plan.host ? (
                <>
                  Runs in the worktree where ‘{into}’ is checked out: <span className="font-mono">{plan.host}</span>
                </>
              ) : needsCheckout ? (
                <>‘{into}’ is not checked out anywhere: it will be checked out here first.</>
              ) : (
                <>‘{into}’ is not checked out anywhere: it is fast-forwarded without a checkout.</>
              )}
            </div>
          )}
          {MERGE_OPTIONS.map((o) => {
            const disabled = o.mode === 'squash' && !squashOk
            return (
              <label key={o.mode} className={cn('flex items-start gap-2 rounded p-1', disabled ? 'opacity-50' : 'cursor-pointer hover:bg-hover')}>
                <input type="radio" className="mt-1" disabled={disabled} checked={effMode === o.mode} onChange={() => setMode(o.mode)} />
                <span>
                  <span className="font-mono text-[13px]">{o.label}</span>
                  <span className="block text-xs text-muted">{disabled ? 'Only into the current branch: the result is staged here for you to commit.' : o.help}</span>
                </span>
              </label>
            )
          })}
          {same ? (
            <div className="text-xs text-danger">Source and target are the same branch.</div>
          ) : ahead === 0 ? (
            <div className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-2 text-xs" data-testid="merge-nothing">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
              Nothing to merge: ‘{source.label}’ has no commits that ‘{into}’ doesn’t already have.
            </div>
          ) : (
            ahead !== null && (
              <div className="text-xs" data-testid="merge-count">
                {ahead} commit{ahead === 1 ? '' : 's'} of ‘{source.label}’ will be merged into ‘{into}’.
              </div>
            )
          )}
          {ahead !== 0 && (changed ?? 0) > 0 && (
            <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              {needsCheckout
                ? `You have ${changed} uncommitted change${changed === 1 ? '' : 's'}: the checkout will offer to stash them (Smart Checkout).`
                : `The working tree has ${changed} uncommitted change${changed === 1 ? '' : 's'}: git refuses the merge if they touch the same files.`}
            </div>
          )}
          {source.rev && ahead !== 0 && !same && mergePreview.render?.({ root, ref: source.rev, into })}
          <div className="text-xs text-muted">A backup of ‘{into ?? 'HEAD'}’ is saved first; you can undo the merge afterwards.</div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            disabled={!source.rev || same || ahead === 0 || (!!into && !plan)}
            data-testid="merge-confirm"
            onClick={() => {
              closeModal()
              void mergeBranchFlow(root, source.rev, source.label, into, effMode)
            }}
          >
            {needsCheckout ? 'Checkout and Merge' : ahead ? `Merge ${ahead} commit${ahead === 1 ? '' : 's'}` : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CommitList({ commits, total, empty, onOpen }: { commits: Commit[]; total: number; empty: string; onOpen?(c: Commit): void }) {
  if (commits.length === 0) return <div className="p-3 text-muted">{empty}</div>
  return (
    <div className="py-1" data-testid="compare-commits">
      {commits.map((c) => (
        <div
          key={c.hash}
          className="flex gap-2 px-3 py-0.5 text-[13px] hover:bg-hover"
          title={onOpen ? 'Double-click to show in the Log' : undefined}
          onDoubleClick={() => onOpen?.(c)}
        >
          <span className="font-mono text-xs text-muted">{shortHash(c.hash)}</span>
          <span className="truncate">{c.subject}</span>
          <span className="ml-auto shrink-0 text-xs text-muted">
            {c.authorName}, {formatDate(c.authorTime)}
          </span>
        </div>
      ))}
      {total > commits.length && <div className="px-3 py-1 text-xs text-muted">… and {total - commits.length} older commits</div>}
    </div>
  )
}

/** Commits on each side and the file diff between two revisions (branches, tags, HEAD, hashes). */
export function ComparePanel({ root, a, b, onOpenCommit }: { root: string; a: RefChoice; b: RefChoice; onOpenCommit?(c: Commit): void }) {
  const [tab, setTab] = useState<'a' | 'b' | 'files'>('a')
  const epoch = useEpoch(root)
  const q = useQuery({ queryKey: ['repo', root, 'compare', a.rev, b.rev, epoch], queryFn: () => api.branch.compare(root, a.rev, b.rev) })
  const tabs = [
    { id: 'a' as const, label: `In ‘${a.label}’ but not ‘${b.label}’ (${q.data?.countA ?? '…'})` },
    { id: 'b' as const, label: `In ‘${b.label}’ but not ‘${a.label}’ (${q.data?.countB ?? '…'})` },
    { id: 'files' as const, label: `Files (${q.data?.files.length ?? '…'})` }
  ]
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1 border-b border-border-strong">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={cn('px-3 py-1 text-[13px]', tab === t.id ? 'border-b-2 border-accent font-medium' : 'text-muted')}
            onClick={() => setTab(t.id)}
            data-testid={`compare-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
        {q.data && (
          <span className="ml-auto truncate pr-2 text-xs text-muted" data-testid="compare-summary">
            {q.data.countA === 0 && q.data.countB === 0
              ? 'Same commit'
              : q.data.mergeBase
                ? `Common ancestor ${shortHash(q.data.mergeBase)}`
                : 'No common history'}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border-strong bg-bg">
        {q.isError && <div className="p-3 text-danger">{q.error.message}</div>}
        {q.data && tab === 'a' && <CommitList commits={q.data.onlyA} total={q.data.countA} empty="Nothing" onOpen={onOpenCommit} />}
        {q.data && tab === 'b' && <CommitList commits={q.data.onlyB} total={q.data.countB} empty="Nothing" onOpen={onOpenCommit} />}
        {tab === 'files' && (
          <ChangesBrowser
            key={`${a.rev}\0${b.rev}`}
            root={root}
            files={q.data?.files ?? []}
            leftRev={b.rev}
            rightRev={a.rev}
            leftLabel={b.label}
            rightLabel={a.label}
            loading={q.isLoading}
          />
        )}
      </div>
    </div>
  )
}

/** Compare two revisions; both sides can be changed to any branch or tag. */
export function CompareDialog({ root, a: a0, aLabel, b: b0, bLabel }: { root: string; a: string; aLabel: string; b: string; bLabel: string }) {
  const [a, setA] = useState<RefChoice>({ rev: a0, label: aLabel })
  const [b, setB] = useState<RefChoice>({ rev: b0, label: bLabel })
  const head = useQuery({ queryKey: ['repo', root, 'info'], queryFn: () => api.repo.info(root) }).data?.branch
  return (
    <Dialog {...useOpen()}>
      <DialogContent className="h-[80vh] max-w-6xl" data-testid="compare-dialog" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            Compare ‘{a.label}’ with ‘{b.label}’
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <RefSelect root={root} value={a} onChange={setA} headLabel={head} testId="compare-a" />
          <Button
            size="icon-sm"
            variant="ghost"
            title="Swap"
            onClick={() => {
              setA(b)
              setB(a)
            }}
            data-testid="compare-swap"
          >
            <ArrowLeftRight />
          </Button>
          <RefSelect root={root} value={b} onChange={setB} headLabel={head} testId="compare-b" />
        </div>
        <div className="min-h-0 flex-1">
          <ComparePanel
            root={root}
            a={a}
            b={b}
            onOpenCommit={(c) => {
              closeModal()
              showInLog(c.hash)
            }}
          />
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
              {outgoing.data && <CommitList commits={list} total={list.length} empty="Nothing to push" />}
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

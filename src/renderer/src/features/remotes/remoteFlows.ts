import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Ref, Remote, RemoteTestResult } from '@shared/types'
import { parseRemoteUrl, redactUrl } from '@shared/remotes'
import { api } from '@/lib/api'
import { attempt, refreshRepo } from '@/lib/gitOps'
import { notifyError } from '@/lib/notify'
import { newId } from '@/lib/utils'
import { confirm } from '@/stores/dialogs'
import { useEpoch } from '@/stores/repoEpoch'

export function useRemotes(root: string) {
  const epoch = useEpoch(root)
  return useQuery({ queryKey: ['repo', root, 'remotes', epoch], queryFn: () => api.remote.list(root) })
}

export interface RemoteUsage {
  /** Remote-tracking branches (refs/remotes/<name>/*, HEAD excluded). */
  branches: number
  /** Local branches whose upstream is on this remote. */
  tracking: string[]
}

export function remoteUsage(refs: Ref[] | undefined, remote: string): RemoteUsage {
  const list = refs ?? []
  return {
    branches: list.filter((r) => r.kind === 'remote' && r.remote === remote && r.short !== `${remote}/HEAD`).length,
    tracking: list.filter((r) => r.kind === 'local' && r.upstream?.startsWith(`${remote}/`)).map((r) => r.short)
  }
}

export function describeTest(t: RemoteTestResult): string {
  if (t.branches === 0 && t.tags === 0) return 'Connected. The repository is empty.'
  const parts = [`${t.branches} branch${t.branches === 1 ? '' : 'es'}`]
  if (t.tags) parts.push(`${t.tags} tag${t.tags === 1 ? '' : 's'}`)
  return `Connected. Found ${parts.join(' and ')}${t.defaultBranch ? `, default branch ${t.defaultBranch}` : ''}.`
}

export async function testRemoteFlow(root: string, r: Remote): Promise<void> {
  const id = toast.loading(`Connecting to ${r.name}…`)
  try {
    const t = await api.remotes.test(root, r.fetchUrl, newId())
    toast.success(`${r.name}: ${describeTest(t)}`, { id })
  } catch (err) {
    toast.dismiss(id)
    notifyError(err, `Could not reach ${r.name}`)
  }
}

export async function removeRemoteFlow(root: string, r: Remote, usage: RemoteUsage): Promise<void> {
  const ok = await confirm({
    title: `Remove remote ${r.name}`,
    message: (
      `Remove “${r.name}” (${redactUrl(r.fetchUrl)}) from this repository? ` +
      (usage.branches ? `Its ${usage.branches} remote-tracking branch${usage.branches === 1 ? '' : 'es'} are removed locally. ` : '') +
      (usage.tracking.length
        ? `${usage.tracking.length} local branch${usage.tracking.length === 1 ? '' : 'es'} (${usage.tracking.slice(0, 3).join(', ')}${usage.tracking.length > 3 ? '…' : ''}) will no longer have an upstream. `
        : '') +
      'Nothing is deleted on the server, and you can add it again later.'
    ),
    confirmLabel: 'Remove Remote',
    destructive: true
  })
  if (!ok) return
  await attempt(async () => {
    await api.remotes.remove(root, r.name)
    refreshRepo(root)
    toast.success(`Removed remote ${r.name}`)
  }, 'Could not remove the remote')
}

export async function pruneRemoteFlow(root: string, r: Remote): Promise<void> {
  await attempt(async () => {
    await api.remotes.prune(root, r.name, newId())
    refreshRepo(root)
    toast.success(`Removed branches of ${r.name} that no longer exist on the server`)
  }, 'Prune failed')
}

/** SSH ↔ HTTPS for well-known hosts; the push URL follows when it was the same as the fetch URL. */
export function switchProtocolTarget(r: Remote): { label: string; url: string } | null {
  const p = parseRemoteUrl(r.fetchUrl)
  if (p.protocol === 'ssh' && p.httpsUrl) return { label: 'HTTPS', url: p.httpsUrl }
  if ((p.protocol === 'https' || p.protocol === 'http') && p.sshUrl) return { label: 'SSH', url: p.sshUrl }
  return null
}

export async function switchProtocolFlow(root: string, r: Remote): Promise<void> {
  const t = switchProtocolTarget(r)
  if (!t) return
  await attempt(async () => {
    const pushUrl = r.pushUrl === r.fetchUrl ? null : r.pushUrl
    await api.remotes.update(root, r.name, { name: r.name, fetchUrl: t.url, pushUrl })
    refreshRepo(root)
    toast.success(`${r.name} now uses ${t.label}`, { description: t.url })
  }, 'Could not change the URL')
}

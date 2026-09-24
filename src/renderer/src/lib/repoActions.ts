import { baseName } from '@shared/display'
import type { RepoResolution } from '@shared/types'
import { useTabsStore, type OpenMode } from '@/stores/tabs'
import { confirm } from '@/stores/dialogs'
import { queryClient } from './queryClient'
import { api } from './api'
import { notifyError } from './notify'

async function openResolvedRoot(root: string, mode: OpenMode): Promise<void> {
  useTabsStore.getState().open(root, mode)
  // Record in recents with the current branch (best effort; info also warms the cache).
  try {
    const info = await queryClient.fetchQuery({ queryKey: ['repo', root, 'info'], queryFn: () => api.repo.info(root) })
    await api.recents.touch(root, info.branch)
  } catch {
    await api.recents.touch(root, null).catch(() => undefined)
  }
}

async function offerInit(res: Extract<RepoResolution, { kind: 'not-repo' }>, mode: OpenMode): Promise<void> {
  const ok = await confirm({
    title: 'Not a Git repository',
    message: `“${res.path}” is not inside a Git repository. Initialize a Git repository here?`,
    confirmLabel: 'Initialize a Git repository here'
  })
  if (!ok) return
  const initRes = await api.repo.init(res.path)
  if (initRes.kind === 'repo') await openResolvedRoot(initRes.root, mode)
}

/**
 * Opens any path: a repo root, a folder inside a repo (opens the root), or a
 * non-repo folder (offers `git init`). Errors surface as toasts.
 */
export async function openRepoPath(path: string, mode: OpenMode = 'new-tab'): Promise<void> {
  try {
    const res = await api.repo.resolve(path)
    switch (res.kind) {
      case 'repo':
        return await openResolvedRoot(res.root, mode)
      case 'not-repo':
        return await offerInit(res, mode)
      case 'missing':
        notifyError(new Error(`Folder not found: ${res.path}`))
        return
      case 'bare':
        notifyError(new Error(`“${baseName(res.path)}” is a bare repository. Bare repositories have no working tree and can't be opened.`))
        return
    }
  } catch (err) {
    notifyError(err, 'Could not open repository')
  }
}

export async function openFolderFlow(mode: OpenMode = 'new-tab'): Promise<void> {
  const path = await api.dialog.pickFolder('Open Folder or Repository')
  if (path) await openRepoPath(path, mode)
}

export async function newRepositoryFlow(): Promise<void> {
  const path = await api.dialog.pickFolder('Choose a folder for the new repository')
  if (!path) return
  try {
    const res = await api.repo.resolve(path)
    if (res.kind === 'repo') {
      const open = await confirm({
        title: 'Already a repository',
        message: `This folder is already inside the Git repository “${res.root}”. Open it instead?`,
        confirmLabel: 'Open'
      })
      if (open) await openResolvedRoot(res.root, 'new-tab')
      return
    }
    const initRes = await api.repo.init(path)
    if (initRes.kind === 'repo') await openResolvedRoot(initRes.root, 'new-tab')
  } catch (err) {
    notifyError(err, 'Could not create repository')
  }
}

/** Folders dropped from the OS file manager onto the window. */
export async function openDroppedFiles(files: FileList): Promise<void> {
  const paths = Array.from(files)
    .map((f) => api.getPathForFile(f))
    .filter(Boolean)
  for (const p of paths) await openRepoPath(p, 'new-tab')
}

import { useQueries } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useWorktrees } from '../worktrees/WorktreeDialogs'

/**
 * Number of worktrees of the repo at `root` (main and linked) that have
 * uncommitted changes. The repo watcher only sees `.git`, not working-tree
 * edits, so this polls; the interval pauses while the window is hidden.
 */
export function useDirtyWorktreeCount(root: string): number {
  const wts = useWorktrees(root).data
  // Before the worktree list arrives, at least check the tab's own checkout.
  const paths = wts ? wts.filter((w) => !w.bare && !w.prunable).map((w) => w.path) : [root]
  return useQueries({
    queries: paths.map((path) => ({
      queryKey: ['quickStatus', path],
      queryFn: () => api.repo.quickStatus(path),
      refetchInterval: 15_000,
      refetchOnWindowFocus: true
    })),
    combine: (results) => results.filter((r) => r.data?.dirty).length
  })
}

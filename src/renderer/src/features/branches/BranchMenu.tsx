import type { Ref } from '@shared/types'
import { api } from '@/lib/api'
import { checkoutFlow, deleteBranchFlow, deleteRemoteBranchFlow, fetchFlow, pullFlow, rebaseFlow, refreshRepo, refToTarget } from '@/lib/gitOps'
import { run } from '@/lib/notify'
import { showRemotes } from '@/lib/views'
import { openModal } from '@/stores/modals'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'

interface Props {
  root: string
  r: Ref
  currentBranch: string | null
  favorite: boolean
  onToggleFavorite(): void
}

/** Branch / remote-branch / tag actions. */
export function BranchMenu({ root, r, currentBranch, favorite, onToggleFavorite }: Props) {
  const isCurrent = r.kind === 'local' && r.short === currentBranch
  const cur = currentBranch ?? 'HEAD'
  const name = r.short
  const extra = tagMenuItems.render?.({ root, r })

  return (
    <>
      {!isCurrent && <ContextMenuItem onSelect={() => void checkoutFlow(root, refToTarget(r))}>Checkout</ContextMenuItem>}
      <ContextMenuItem onSelect={() => openModal({ kind: 'newBranch', root, start: r.name, startLabel: name })}>New Branch from ‘{name}’…</ContextMenuItem>
      {r.kind !== 'remote' && (
        <ContextMenuItem onSelect={() => openModal({ kind: 'addWorktree', root, start: name })}>New Worktree from ‘{name}’…</ContextMenuItem>
      )}
      {!isCurrent && r.kind === 'local' && currentBranch && (
        <ContextMenuItem onSelect={() => void rebaseFlow(root, currentBranch, name)}>Checkout and Rebase onto ‘{cur}’</ContextMenuItem>
      )}
      {!isCurrent && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void rebaseFlow(root, r.name, null)}>
            Rebase ‘{cur}’ onto ‘{name}’
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openModal({ kind: 'merge', root, ref: r.name, label: name, current: currentBranch })}>
            Merge ‘{name}’ into ‘{cur}’…
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openModal({ kind: 'compare', root, a: r.name, aLabel: name, b: 'HEAD', bLabel: cur })}>
            Compare with ‘{cur}’
          </ContextMenuItem>
        </>
      )}
      {isCurrent && (
        <ContextMenuItem onSelect={() => openModal({ kind: 'compare', root, a: r.name, aLabel: name, b: 'HEAD', bLabel: cur })}>
          Compare with…
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => openModal({ kind: 'worktreeDiff', root, rev: r.name, label: name })}>Show Diff with Working Tree</ContextMenuItem>
      <ContextMenuSeparator />
      {r.kind === 'local' && (
        <>
          <ContextMenuItem onSelect={() => openModal({ kind: 'push', root, branch: name })}>Push…</ContextMenuItem>
          {isCurrent && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>Pull</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => void pullFlow(root, 'merge')}>Pull (merge)</ContextMenuItem>
                <ContextMenuItem onSelect={() => void pullFlow(root, 'rebase')}>Pull (rebase)</ContextMenuItem>
                <ContextMenuItem onSelect={() => void pullFlow(root, 'ff-only')}>Pull (fast-forward only)</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuItem onSelect={() => openModal({ kind: 'upstream', root, branch: name })}>Set Upstream…</ContextMenuItem>
          {r.upstream && (
            <ContextMenuItem
              onSelect={() =>
                run(async () => {
                  await api.branch.setUpstream(root, name, null)
                  refreshRepo(root)
                })
              }
            >
              Unset Upstream ({r.upstream})
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openModal({ kind: 'renameBranch', root, branch: r })}>Rename…</ContextMenuItem>
          {!isCurrent && <ContextMenuItem onSelect={() => void deleteBranchFlow(root, name)}>Delete</ContextMenuItem>}
        </>
      )}
      {r.kind === 'remote' && (
        <>
          <ContextMenuItem onSelect={() => void fetchFlow(root, r.remote ?? null)}>Fetch ‘{r.remote}’</ContextMenuItem>
          <ContextMenuItem onSelect={() => void deleteRemoteBranchFlow(root, r.remote!, name.slice((r.remote?.length ?? 0) + 1))}>
            Delete Remote Branch…
          </ContextMenuItem>
          <ContextMenuItem onSelect={showRemotes}>Manage Remotes…</ContextMenuItem>
        </>
      )}
      {extra}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onToggleFavorite}>{favorite ? 'Remove from Favorites' : 'Add to Favorites'}</ContextMenuItem>
      <ContextMenuItem onSelect={() => run(() => api.shell.copyText(name))}>Copy Name</ContextMenuItem>
    </>
  )
}

/** Tag-specific items are contributed by the tags feature (M7). */
export const tagMenuItems: { render?: (p: { root: string; r: Ref }) => React.ReactNode } = {}

import type { Commit } from '@shared/types'
import { WORKTREE } from '@shared/types'
import { api } from '@/lib/api'
import { run } from '@/lib/notify'
import {
  cherryPickFlow,
  checkoutRevisionFlow,
  dropFlow,
  interactiveRebaseFlow,
  patchFlow,
  revertFlow,
  rewordFlow,
  squashSelectedFlow,
  undoCommitFlow
} from '@/lib/rewriteFlows'
import { openModal } from '@/stores/modals'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import type { DiffSide } from '../diff/LazyDiffViewer'

interface Props {
  root: string
  /** Newest first. */
  selected: Commit[]
  headSha: string | null
  currentBranch: string | null
  /** Current-branch commits in log order, for the Fixup/Squash target chooser. */
  branchCommits: () => Commit[]
  openDiff(left: DiffSide, right: DiffSide, title?: string): void
}

/** Right-click menu of the log (single or multi-select) */
export function CommitMenu({ root, selected, headSha, currentBranch, branchCommits }: Props) {
  const single = selected.length === 1 ? selected[0]! : null
  const onBranch = selected.every((c) => c.onCurrentBranch)
  const hasMerge = selected.some((c) => c.parents.length > 1)
  const isHead = single?.hash === headSha
  const branch = currentBranch ?? 'HEAD'
  const n = selected.length
  const s = n === 1 ? '' : 's'

  return (
    <>
      <ContextMenuItem onSelect={() => run(() => api.shell.copyText(selected.map((c) => c.hash).join('\n')))}>Copy Revision Hash{s}</ContextMenuItem>
      <ContextMenuItem onSelect={() => run(() => api.shell.copyText(selected.map((c) => c.subject).join('\n')))}>Copy Subject{s}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void patchFlow(root, selected)}>Create Patch…</ContextMenuItem>
      <ContextMenuItem disabled={onBranch} onSelect={() => void cherryPickFlow(root, selected)}>
        Cherry-Pick
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void revertFlow(root, selected)}>Revert Commit{s}</ContextMenuItem>
      {single && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void checkoutRevisionFlow(root, single)}>Checkout Revision</ContextMenuItem>
          <ContextMenuItem onSelect={() => openModal({ kind: 'newBranch', root, start: single.hash, startLabel: `${single.hash.slice(0, 8)} ${single.subject}` })}>
            New Branch…
          </ContextMenuItem>
          {commitMenuExtras.newTag?.(root, single)}
          <ContextMenuItem onSelect={() => openModal({ kind: 'reset', root, commit: single, branch: currentBranch })}>Reset Current Branch to Here…</ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      {isHead && !hasMerge && <ContextMenuItem onSelect={() => void undoCommitFlow(root)}>Undo Commit</ContextMenuItem>}
      {single && (
        <ContextMenuItem disabled={!onBranch || hasMerge} onSelect={() => void rewordFlow(root, single, headSha)}>
          Edit Commit Message…
        </ContextMenuItem>
      )}
      <ContextMenuItem
        disabled={!onBranch || hasMerge}
        onSelect={() => openModal({ kind: 'fixupTarget', root, selected, mode: 'fixup', candidates: branchCommits() })}
      >
        Fixup…
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!onBranch || hasMerge}
        onSelect={() => openModal({ kind: 'fixupTarget', root, selected, mode: 'squash', candidates: branchCommits() })}
      >
        Squash Into…
      </ContextMenuItem>
      {n > 1 && (
        <ContextMenuItem disabled={!onBranch || hasMerge} onSelect={() => void squashSelectedFlow(root, selected)}>
          Squash Commits…
        </ContextMenuItem>
      )}
      <ContextMenuItem disabled={!onBranch || hasMerge} onSelect={() => void dropFlow(root, selected)}>
        Drop Commit{s}
      </ContextMenuItem>
      {single && (
        <ContextMenuItem disabled={!onBranch || hasMerge} onSelect={() => interactiveRebaseFlow(root, single)}>
          Interactive Rebase from Here…
        </ContextMenuItem>
      )}
      {single && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openModal({ kind: 'compare', root, a: single.hash, aLabel: single.hash.slice(0, 8), b: 'HEAD', bLabel: branch })}>
            Compare with Local
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openModal({ kind: 'worktreeDiff', root, rev: single.hash, label: single.hash.slice(0, 8) })}>
            Show Diff with Working Tree
          </ContextMenuItem>
        </>
      )}
    </>
  )
}

/** Contributed by later features (tags: M7). */
export const commitMenuExtras: { newTag?: (root: string, c: Commit) => React.ReactNode } = {}

export { WORKTREE }

import { useModals } from '@/stores/modals'
import {
  CompareDialog,
  MergeDialog,
  NewBranchDialog,
  PushDialog,
  RenameBranchDialog,
  UpstreamDialog,
  WorktreeDiffDialog
} from '../branches/BranchDialogs'

/** Renders the current parametrised dialog (see stores/modals). */
export function ModalHost() {
  const m = useModals((s) => s.modal)
  if (!m) return null
  switch (m.kind) {
    case 'newBranch':
      return <NewBranchDialog {...m} />
    case 'renameBranch':
      return <RenameBranchDialog {...m} />
    case 'merge':
      return <MergeDialog {...m} />
    case 'compare':
      return <CompareDialog {...m} />
    case 'worktreeDiff':
      return <WorktreeDiffDialog {...m} />
    case 'upstream':
      return <UpstreamDialog {...m} />
    case 'push':
      return <PushDialog {...m} />
  }
}

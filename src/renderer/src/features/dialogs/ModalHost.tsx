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
import { ConflictsDialog, MergeEditorModal } from '../merge/ConflictsDialog'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ShortcutsDialog } from '../settings/ShortcutsDialog'
import { UpdateDialog } from '../settings/UpdateDialog'
import { NewTagDialog, RemotesDialog, StashCreateDialog } from '../stash/M7Dialogs'
import { FixupTargetDialog, InteractiveRebaseDialog, ReflogDialog, ResetDialog } from '../rewrite/RewriteDialogs'

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
    case 'interactiveRebase':
      return <InteractiveRebaseDialog {...m} />
    case 'reset':
      return <ResetDialog {...m} />
    case 'fixupTarget':
      return <FixupTargetDialog {...m} />
    case 'reflog':
      return <ReflogDialog {...m} />
    case 'stashCreate':
      return <StashCreateDialog {...m} />
    case 'newTag':
      return <NewTagDialog {...m} />
    case 'remotes':
      return <RemotesDialog {...m} />
    case 'conflicts':
      return <ConflictsDialog {...m} />
    case 'mergeEditor':
      return <MergeEditorModal {...m} />
    case 'settings':
      return <SettingsDialog />
    case 'shortcuts':
      return <ShortcutsDialog />
    case 'update':
      return <UpdateDialog {...m} />
  }
}

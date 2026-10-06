import { create } from 'zustand'
import type { Commit, Ref, Remote, UpdateInfo, WorktreeEntry } from '@shared/types'

/** Parametrised dialogs; one at a time, rendered by <ModalHost/>. */
export type Modal =
  | { kind: 'newBranch'; root: string; start: string; startLabel: string }
  | { kind: 'renameBranch'; root: string; branch: Ref }
  | { kind: 'merge'; root: string; ref: string; label: string; current: string | null }
  | { kind: 'compare'; root: string; a: string; aLabel: string; b: string; bLabel: string }
  | { kind: 'worktreeDiff'; root: string; rev: string; label: string }
  | { kind: 'upstream'; root: string; branch: string }
  | { kind: 'push'; root: string; branch?: string }
  | { kind: 'interactiveRebase'; root: string; base: string | null; fromLabel: string }
  | { kind: 'reset'; root: string; commit: Commit; branch: string | null }
  | { kind: 'fixupTarget'; root: string; selected: Commit[]; mode: 'fixup' | 'squash'; candidates: Commit[] }
  | { kind: 'reflog'; root: string }
  | { kind: 'stashCreate'; root: string }
  | { kind: 'newTag'; root: string; target: string; label: string }
  /** Add a remote, or edit `remote`. */
  | { kind: 'remote'; root: string; remote?: Remote }
  | { kind: 'addWorktree'; root: string; start?: string }
  | { kind: 'removeWorktree'; root: string; worktree: WorktreeEntry }
  | { kind: 'mergeWorktree'; root: string; worktree: WorktreeEntry }
  | { kind: 'conflicts'; root: string }
  | { kind: 'mergeEditor'; root: string; path: string }
  | { kind: 'settings' }
  | { kind: 'shortcuts' }
  | { kind: 'update'; info: UpdateInfo }

interface ModalState {
  modal: Modal | null
  open(m: Modal): void
  close(): void
}

export const useModals = create<ModalState>((set) => ({
  modal: null,
  open: (modal) => set({ modal }),
  close: () => set({ modal: null })
}))

export const openModal = (m: Modal): void => useModals.getState().open(m)
export const closeModal = (): void => useModals.getState().close()

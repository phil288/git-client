import { create } from 'zustand'

/** Bumped on every 'repo:changed' event; views key their reloads on it. */
export const useRepoEpoch = create<{ epochs: Record<string, number>; bump(root: string): void }>((set, get) => ({
  epochs: {},
  bump: (root) => set({ epochs: { ...get().epochs, [root]: (get().epochs[root] ?? 0) + 1 } })
}))

export function useEpoch(root: string): number {
  return useRepoEpoch((s) => s.epochs[root] ?? 0)
}

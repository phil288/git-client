import { useTabsStore } from '@/stores/tabs'

/** Switches the active tab to a view (tool window). */
function show(patch: Record<string, unknown>): void {
  const { activeId, setUi } = useTabsStore.getState()
  if (activeId) setUi(activeId, patch)
}

export const showFileHistory = (path: string): void => show({ view: 'history', historyPath: path })
export const showBlame = (path: string, rev: string | null = null): void => show({ view: 'blame', blamePath: path, blameRev: rev })
/** Opens the Log and selects `hash` (loading pages until it is found). */
export const showInLog = (hash: string): void => show({ view: 'log', logPendingGoTo: hash })

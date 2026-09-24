import { create } from 'zustand'
import type { ProgressEvent } from '@shared/types'

interface OpsState {
  running: Record<string, ProgressEvent>
  last: Record<string, ProgressEvent>
  update(e: ProgressEvent): void
}

/** Live progress of long-running operations, fed by 'op:progress' events. */
export const useOpsStore = create<OpsState>((set, get) => ({
  running: {},
  last: {},
  update(e) {
    const running = { ...get().running }
    if (e.done) delete running[e.opId]
    else running[e.opId] = e
    set({ running, last: { ...get().last, [e.opId]: e } })
  }
}))

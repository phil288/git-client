import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppInfo, type GitStatus, type Settings } from '@shared/types'
import { api } from '@/lib/api'

type DialogName = 'clone' | 'scan' | 'quickSwitcher'

interface AppState {
  info: AppInfo | null
  gitStatus: GitStatus | null
  settings: Settings
  dialogs: Record<DialogName, boolean>
  setInfo(info: AppInfo): void
  setGitStatus(status: GitStatus): void
  setSettings(settings: Settings): void
  updateSettings(patch: Partial<Settings>): Promise<void>
  openDialog(name: DialogName): void
  closeDialog(name: DialogName): void
  setDialog(name: DialogName, open: boolean): void
}

export const useAppStore = create<AppState>((set, get) => ({
  info: null,
  gitStatus: null,
  settings: DEFAULT_SETTINGS,
  dialogs: { clone: false, scan: false, quickSwitcher: false },
  setInfo: (info) => set({ info }),
  setGitStatus: (gitStatus) => set({ gitStatus }),
  setSettings: (settings) => set({ settings }),
  async updateSettings(patch) {
    // Optimistic: UI toggles (console, sizes) must feel instant.
    set({ settings: { ...get().settings, ...patch } })
    set({ settings: await api.settings.update(patch) })
  },
  openDialog: (name) => set({ dialogs: { ...get().dialogs, [name]: true } }),
  closeDialog: (name) => set({ dialogs: { ...get().dialogs, [name]: false } }),
  setDialog: (name, open) => set({ dialogs: { ...get().dialogs, [name]: open } })
}))

import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { FolderInput } from 'lucide-react'
import type { MenuCommand, WorktreeEntry } from '@shared/types'
import { api } from '@/lib/api'
import { notifyError } from '@/lib/notify'
import { isMac } from '@/lib/utils'
import { shortcutFor } from '@shared/shortcuts'
import { queryClient } from '@/lib/queryClient'
import { newRepositoryFlow, openDroppedFiles, openFolderFlow, openRepoPath } from '@/lib/repoActions'
import { useAppStore } from '@/stores/app'
import { openModal } from '@/stores/modals'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { checkForUpdatesFlow } from '@/lib/updates'
import { useOpsStore } from '@/stores/ops'
import { useRepoEpoch } from '@/stores/repoEpoch'
import { useShallow } from 'zustand/react/shallow'
import { persistSession, selectActiveTabRef, useTabsStore } from '@/stores/tabs'
import { GitConsole, useConsoleStore } from '@/features/console/GitConsole'
import { CloneDialog } from '@/features/dialogs/CloneDialog'
import { DialogHost } from '@/features/dialogs/DialogHost'
import { ModalHost } from '@/features/dialogs/ModalHost'
import { MessageDialogHost } from '@/features/rewrite/MessageDialog'
import '@/lib/rewriteFlows'
import '@/features/stash/M7Dialogs'
import { RepoToolbar } from '@/features/repo/RepoToolbar'
import { ScanDialog } from '@/features/dialogs/ScanDialog'
import { GitMissingScreen } from '@/features/gitcheck/GitMissingScreen'
import { RepoView } from '@/features/repo/RepoView'
import { StatusBar } from '@/features/status/StatusBar'
import { QuickSwitcher } from '@/features/switcher/QuickSwitcher'
import { RepoSwitcher } from '@/features/switcher/RepoSwitcher'
import { TabBar } from '@/features/tabs/TabBar'
import { WelcomeScreen } from '@/features/welcome/WelcomeScreen'

function handleMenuCommand(cmd: MenuCommand): void {
  const app = useAppStore.getState()
  const tabs = useTabsStore.getState()
  if (typeof cmd === 'object') {
    if (cmd.type === 'goto-tab') tabs.activateIndex(cmd.index)
    else void openRepoPath(cmd.path, 'new-tab')
    return
  }
  switch (cmd) {
    case 'open-folder':
      void openFolderFlow()
      break
    case 'clone':
      app.openDialog('clone')
      break
    case 'scan':
      app.openDialog('scan')
      break
    case 'new-repo':
      void newRepositoryFlow()
      break
    case 'quick-switcher':
      app.openDialog('quickSwitcher')
      break
    case 'welcome':
      tabs.showWelcome()
      break
    case 'close-tab':
      if (tabs.activeId) tabs.close(tabs.activeId)
      break
    case 'next-tab':
      tabs.cycle(1)
      break
    case 'prev-tab':
      tabs.cycle(-1)
      break
    case 'show-commit':
    case 'show-log':
      if (tabs.activeId) tabs.setUi(tabs.activeId, { view: cmd === 'show-commit' ? 'commit' : 'log' })
      break
    case 'settings':
      openModal({ kind: 'settings' })
      break
    case 'shortcuts':
      openModal({ kind: 'shortcuts' })
      break
    case 'check-updates':
      void checkForUpdatesFlow(true)
      break
    case 'toggle-console':
      void app.updateSettings({ showConsole: !app.settings.showConsole })
      break
  }
}

/** Wires main-process push events into stores and the query cache. */
function useMainEvents(): void {
  useEffect(() => {
    const offs = [
      api.on('console:entry', (e) => useConsoleStore.getState().upsert(e)),
      api.on('op:progress', (e) => useOpsStore.getState().update(e)),
      api.on('repo:changed', ({ root }) => {
        useRepoEpoch.getState().bump(root)
        void queryClient.invalidateQueries({ queryKey: ['repo', root] })
        void queryClient.invalidateQueries({ queryKey: ['quickStatus', root] })
        // Refs are shared, so a commit in any worktree lands here: refresh the
        // sibling worktrees' status too (it feeds the tab's dirty dot).
        for (const w of queryClient.getQueryData<WorktreeEntry[]>(['repo', root, 'worktrees']) ?? []) {
          if (w.path !== root) void queryClient.invalidateQueries({ queryKey: ['quickStatus', w.path] })
        }
      }),
      api.on('recents:changed', (state) => queryClient.setQueryData(['recents'], state)),
      api.on('app:openRepo', (req) => void openRepoPath(req.path, req.newTab ? 'new-tab' : 'replace')),
      api.on('menu:command', handleMenuCommand),
      api.on('git:statusChanged', (s) => useAppStore.getState().setGitStatus(s))
    ]
    return () => offs.forEach((off) => off())
  }, [])
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const cmd = shortcutFor(e, isMac)
      if (!cmd) return
      // Let modal dialogs keep their own keyboard handling.
      if (document.querySelector('[role="dialog"]') && cmd !== 'toggle-console') return
      e.preventDefault()
      handleMenuCommand(cmd)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Accepts folders dragged from the OS file manager anywhere in the window. */
function useFolderDrop(): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const isFileDrag = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const enter = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      depth = 0
      setDragging(false)
      if (!isFileDrag(e) || !e.dataTransfer) return
      e.preventDefault()
      void openDroppedFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return dragging
}

/** StrictMode runs effects twice in dev; bootstrap must run once per page load. */
let bootstrapStarted = false

export function App() {
  const [ready, setReady] = useState(false)
  const gitStatus = useAppStore((s) => s.gitStatus)
  const showConsole = useAppStore((s) => s.settings.showConsole)
  const activeTab = useTabsStore(useShallow(selectActiveTabRef))
  const dragging = useFolderDrop()
  useMainEvents()
  useShortcuts()

  useEffect(() => {
    if (bootstrapStarted) return
    bootstrapStarted = true
    void (async () => {
      try {
        const [info, status, settings, session, log] = await Promise.all([
          api.app.getInfo(),
          api.git.getStatus(),
          api.settings.get(),
          api.session.get(),
          api.console.list()
        ])
        const app = useAppStore.getState()
        app.setInfo(info)
        app.setGitStatus(status)
        app.setSettings(settings)
        useConsoleStore.getState().set(log)
        if (settings.reopenLastSession && status.state === 'ok') useTabsStore.getState().restore(session)
        persistSession() // lives for the whole page lifetime
        if (settings.checkForUpdates && info.isPackaged) setTimeout(() => void checkForUpdatesFlow(false), 5000)
        setReady(true)
        const pending = await api.app.takePendingOpens()
        for (const req of pending) await openRepoPath(req.path, req.newTab ? 'new-tab' : 'replace')
      } catch (err) {
        notifyError(err, 'Startup failed')
        setReady(true)
      }
    })()
  }, [])

  if (!ready || !gitStatus) return <div className="h-full bg-bg" />

  return (
    <div className="flex h-full flex-col bg-bg">
      {gitStatus.state !== 'ok' ? (
        <div className="min-h-0 flex-1">
          <GitMissingScreen status={gitStatus} />
        </div>
      ) : (
        <>
          <header className="flex h-9 shrink-0 items-stretch border-b border-border-strong bg-panel">
            <RepoSwitcher />
            <TabBar />
            {activeTab && <RepoToolbar root={activeTab.path} />}
          </header>
          <div className="min-h-0 flex-1">{activeTab ? (
              <ErrorBoundary key={activeTab.id} label={activeTab.name}>
                <RepoView tab={activeTab} />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary label="The welcome screen">
                <WelcomeScreen />
              </ErrorBoundary>
            )}</div>
          {showConsole && <GitConsole />}
        </>
      )}
      <StatusBar />
      <CloneDialog />
      <ScanDialog />
      <QuickSwitcher />
      <ModalHost />
      <MessageDialogHost />
      <DialogHost />
      <Toaster theme="system" position="bottom-right" richColors closeButton offset={36} />
      {dragging && (
        <div className="pointer-events-none fixed inset-2 z-[100] flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10">
          <div className="flex items-center gap-2 rounded-lg bg-panel px-4 py-2 shadow-xl">
            <FolderInput className="size-5 text-accent" /> Drop a folder to open it
          </div>
        </div>
      )}
    </div>
  )
}

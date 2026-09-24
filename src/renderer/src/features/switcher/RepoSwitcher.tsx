import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Download, FolderOpen, GitBranch, Home } from 'lucide-react'
import { api } from '@/lib/api'
import { openFolderFlow, openRepoPath } from '@/lib/repoActions'
import { isPrimaryModifier } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useShallow } from 'zustand/react/shallow'
import { selectActiveTabRef, useTabsStore } from '@/stores/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RepoAvatar } from '../welcome/RepoAvatar'
import { RepoList } from './RepoList'

/** Title-bar project widget: current repo + branch; opens a searchable recent list. */
export function RepoSwitcher() {
  const [open, setOpen] = useState(false)
  const active = useTabsStore(useShallow(selectActiveTabRef))
  const showWelcome = useTabsStore((s) => s.showWelcome)
  const openDialog = useAppStore((s) => s.openDialog)
  const info = useQuery({
    queryKey: ['repo', active?.path ?? '', 'info'],
    queryFn: () => api.repo.info(active!.path),
    enabled: !!active
  })
  const branch = info.data ? (info.data.detached ? info.data.headSha?.slice(0, 8) : info.data.branch) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="repo-switcher"
          className="flex max-w-72 shrink-0 items-center gap-2 border-r border-border-strong px-3 hover:bg-hover"
        >
          {active ? <RepoAvatar name={active.name} size={20} /> : <RepoAvatar name="Git Client" size={20} />}
          <span className="truncate font-semibold">{active ? active.name : 'GitClient'}</span>
          {branch && (
            <span className="flex min-w-0 items-center gap-0.5 truncate text-xs text-muted">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <RepoList
          currentPath={active?.path}
          onPick={(r, e) => {
            setOpen(false)
            void openRepoPath(r.path, isPrimaryModifier(e) ? 'new-tab' : 'replace')
          }}
        />
        <div className="flex gap-1 border-t border-border-strong p-1">
          <button className="flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-hover" onClick={() => (setOpen(false), void openFolderFlow())}>
            <FolderOpen className="size-3.5" /> Open…
          </button>
          <button className="flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-hover" onClick={() => (setOpen(false), openDialog('clone'))}>
            <Download className="size-3.5" /> Clone…
          </button>
          <button className="ml-auto flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-hover" onClick={() => (setOpen(false), showWelcome())}>
            <Home className="size-3.5" /> Welcome Screen
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

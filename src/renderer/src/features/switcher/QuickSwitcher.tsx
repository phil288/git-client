import { openRepoPath } from '@/lib/repoActions'
import { isPrimaryModifier } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { RepoList } from './RepoList'

/** Ctrl+E / Ctrl+Shift+O popup: fuzzy search over recent repos. */
export function QuickSwitcher() {
  const open = useAppStore((s) => s.dialogs.quickSwitcher)
  const setDialog = useAppStore((s) => s.setDialog)
  return (
    <Dialog open={open} onOpenChange={(o) => setDialog('quickSwitcher', o)}>
      <DialogContent hideClose className="top-[20%] max-w-xl translate-y-0 gap-0 p-0" aria-describedby={undefined}>
        <DialogTitle className="px-3 pt-2 text-xs font-normal text-muted">Recent Repositories</DialogTitle>
        <RepoList
          onPick={(r, e) => {
            setDialog('quickSwitcher', false)
            void openRepoPath(r.path, isPrimaryModifier(e) ? 'background' : 'new-tab')
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

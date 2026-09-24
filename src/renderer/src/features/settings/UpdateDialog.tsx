import { toast } from 'sonner'
import type { UpdateInfo } from '@shared/types'
import { api } from '@/lib/api'
import { run } from '@/lib/notify'
import { closeModal } from '@/stores/modals'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Linux: "Version X is available" with the one-line update command. */
export function UpdateDialog({ info }: { info: UpdateInfo }) {
  return (
    <Dialog open onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className="max-w-lg" data-testid="update-dialog">
        <DialogHeader>
          <DialogTitle>GitClient {info.latest} is available</DialogTitle>
          <DialogDescription>You have {info.current}.</DialogDescription>
        </DialogHeader>
        {info.updateCommand ? (
          <div className="flex flex-col gap-1 text-[13px]">
            Run this in a terminal to update:
            <pre className="selectable whitespace-pre-wrap rounded bg-panel-2 p-2 font-mono text-xs">{info.updateCommand}</pre>
          </div>
        ) : (
          <div className="text-[13px] text-muted">Download the new version from the release page.</div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => run(() => api.shell.openExternal(info.releaseUrl))}>
            Open release page
          </Button>
          {info.updateCommand && (
            <Button
              onClick={() =>
                run(async () => {
                  await api.shell.copyText(info.updateCommand!)
                  toast.success('Update command copied')
                })
              }
            >
              Copy update command
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

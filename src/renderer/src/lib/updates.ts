import { toast } from 'sonner'
import { openModal } from '@/stores/modals'
import { api } from './api'
import { notifyError } from './notify'
import { newId } from './utils'

/**
 * Checks GitHub for a newer release. Windows: one-click download + restart
 * (electron-updater). Linux: dialog with the matching update command
 * (.deb vs --user install) and the release page.
 */
export async function checkForUpdatesFlow(manual: boolean): Promise<void> {
  try {
    const info = await api.update.check()
    if (info.error) {
      if (manual) notifyError(new Error(info.error), 'Update check failed')
      return
    }
    if (!info.available) {
      if (manual) toast.success(`GitClient ${info.current} is up to date`)
      return
    }
    if (info.channel === 'windows-nsis') {
      toast(`GitClient ${info.latest} is available`, {
        duration: 30_000,
        action: {
          label: 'Download and restart',
          onClick: () => void api.update.install(newId()).catch((err) => notifyError(err, 'Update failed'))
        }
      })
      return
    }
    openModal({ kind: 'update', info })
  } catch (err) {
    if (manual) notifyError(err, 'Update check failed')
  }
}

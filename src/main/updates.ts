import { app, net } from 'electron'
import type { UpdateInfo } from '@shared/types'
import pkg from '../../package.json'
import { newerThan, repoSlug as slugOf } from '@shared/versions'
import { AppError } from './git/errors'

const repoSlug = (): string | null => slugOf(pkg.repository.url)

export function installChannel(): UpdateInfo['channel'] {
  if (!app.isPackaged) return 'dev'
  if (process.platform === 'win32') return 'windows-nsis'
  if (process.platform !== 'linux') return 'unknown'
  if (process.env.APPIMAGE) return 'linux-appimage'
  if (process.execPath.startsWith('/opt/')) return 'linux-deb'
  if (process.execPath.includes('/.local/share/gitclient/')) return 'linux-user'
  return 'unknown'
}

/**
 * Latest release tag without the GitHub API (no rate limit): /releases/latest
 * redirects to /releases/tag/<tag>.
 */
async function latestTag(slug: string): Promise<string> {
  const res = await net.fetch(`https://github.com/${slug}/releases/latest`, { method: 'HEAD', redirect: 'manual' })
  const loc = res.headers.get('location') ?? ''
  const m = /\/releases\/tag\/([^/?#]+)$/.exec(loc)
  if (!m) throw new AppError(`Could not determine the latest release (HTTP ${res.status}).`, 'UNKNOWN')
  return decodeURIComponent(m[1]!)
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const channel = installChannel()
  const slug = repoSlug()
  const base: UpdateInfo = { current, latest: null, available: false, channel, releaseUrl: slug ? `https://github.com/${slug}/releases/latest` : '' }
  if (!slug) return { ...base, error: 'Updates are not configured: set "repository" in package.json to the GitHub repository.' }
  try {
    const tag = await latestTag(slug)
    const latest = tag.replace(/^v/, '')
    const available = newerThan(latest, current)
    const script = `https://raw.githubusercontent.com/${slug}/main/install.sh`
    const updateCommand =
      channel === 'linux-deb' ? `curl -fsSL ${script} | bash` : channel === 'linux-user' ? `curl -fsSL ${script} | bash -s -- --user` : undefined
    return { ...base, latest, available, releaseUrl: `https://github.com/${slug}/releases/tag/${encodeURIComponent(tag)}`, updateCommand }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Windows (NSIS): one-click update through electron-updater (GitHub provider, app-update.yml). */
export async function downloadAndInstall(progress: (message: string, percent: number | null) => void): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged) throw new AppError('In-app installation is only available on Windows.', 'INVALID_ARGUMENT')
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('download-progress', (p) => progress(`Downloading ${Math.round(p.percent)}%`, Math.round(p.percent)))
  const result = await autoUpdater.checkForUpdates()
  if (!result?.isUpdateAvailable) throw new AppError('No update available.', 'INVALID_ARGUMENT')
  await autoUpdater.downloadUpdate()
  progress('Installing…', 100)
  // Silent, then relaunch the updated app.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

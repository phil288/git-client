import { AlertTriangle } from 'lucide-react'
import type { GitStatus } from '@shared/types'
import { api } from '@/lib/api'
import { run } from '@/lib/notify'
import { useAppStore } from '@/stores/app'
import { Button } from '@/components/ui/button'

/** Shown instead of the app when git is missing or older than the minimum. */
export function GitMissingScreen({ status }: { status: Exclude<GitStatus, { state: 'ok' }> }) {
  const setGitStatus = useAppStore((s) => s.setGitStatus)
  const platform = useAppStore((s) => s.info?.platform)
  const installCmd = platform === 'win32' ? 'winget install --id Git.Git -e' : 'sudo apt install git'

  return (
    <div className="flex h-full items-center justify-center p-8" data-testid="git-missing">
      <div className="max-w-2xl space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-8 text-warning" />
          <h1 className="text-xl font-semibold">{status.state === 'missing' ? 'Git was not found' : 'Git is too old'}</h1>
        </div>
        {status.state === 'missing' ? (
          <p>
            GitClient runs your system&apos;s <code>git</code> executable and could not find one
            {status.configuredPath ? ` at the configured path “${status.configuredPath}”` : ''}.
          </p>
        ) : (
          <p>
            Found git {status.git.version} at <code>{status.git.path}</code>, but GitClient needs git {status.minimum} or newer.
          </p>
        )}
        <div>
          Install or update it, then press Retry:
          <pre className="selectable mt-1 rounded bg-panel-2 p-2 font-mono text-xs">{installCmd}</pre>
        </div>
        {status.state === 'missing' && status.searched.length > 0 && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Searched locations</summary>
            <ul className="selectable mt-1 max-h-48 overflow-auto font-mono">
              {status.searched.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex gap-2">
          <Button onClick={() => run(async () => setGitStatus(await api.git.recheck()))}>Retry</Button>
          <Button variant="secondary" onClick={() => run(async () => setGitStatus(await api.git.pickExecutable()))}>
            Choose git executable…
          </Button>
          {status.state === 'missing' && status.configuredPath && (
            <Button variant="secondary" onClick={() => run(() => useAppStore.getState().updateSettings({ gitPath: null }))}>
              Use auto-detection
            </Button>
          )}
          <Button variant="link" onClick={() => run(() => api.shell.openExternal('https://git-scm.com/downloads'))}>
            Download Git
          </Button>
        </div>
      </div>
    </div>
  )
}

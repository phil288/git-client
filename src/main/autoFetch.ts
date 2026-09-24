import type { GitRunner } from './git/runner'

/**
 * Background `git fetch --all --prune` for every open repository every N
 * minutes (Settings → Auto-fetch). Commands are logged as background in the
 * Git Console; failures are silent here (no network, auth prompts disabled).
 */
export class AutoFetcher {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly runner: GitRunner,
    private readonly roots: () => string[],
    private readonly onFetched: (root: string) => void
  ) {}

  configure(minutes: number): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (minutes > 0) {
      this.timer = setInterval(() => void this.tick(), minutes * 60_000)
      this.timer.unref()
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const root of this.roots()) {
        try {
          await this.runner.run(['fetch', '--all', '--prune', '--quiet'], { cwd: root, quiet: true, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } })
          this.onFetched(root)
        } catch {
          // offline / auth required / repo gone: try again next time
        }
      }
    } finally {
      this.running = false
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }
}

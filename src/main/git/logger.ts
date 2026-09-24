import { EventEmitter } from 'node:events'
import type { CommandLogEntry } from '@shared/types'

const MAX_ENTRIES = 2000
/** Keep the console readable and IPC payloads small. */
const MAX_STDERR = 16 * 1024

/**
 * Records every git invocation for the "Git Console" panel.
 * Emits 'entry' twice per command: once when it starts (running: true) and
 * once when it finishes, with the same id.
 */
export class CommandLogger extends EventEmitter<{ entry: [CommandLogEntry] }> {
  private entries: CommandLogEntry[] = []
  private nextId = 1

  start(cwd: string | null, args: readonly string[]): CommandLogEntry {
    const entry: CommandLogEntry = {
      id: this.nextId++,
      cwd,
      args: [...args],
      startedAt: Date.now(),
      durationMs: 0,
      exitCode: null,
      stderr: '',
      cancelled: false,
      running: true
    }
    this.push(entry)
    return entry
  }

  finish(entry: CommandLogEntry, exitCode: number | null, stderr: string, cancelled: boolean): void {
    const done: CommandLogEntry = {
      ...entry,
      durationMs: Date.now() - entry.startedAt,
      exitCode,
      stderr: stderr.length > MAX_STDERR ? stderr.slice(0, MAX_STDERR) + '\n… (truncated)' : stderr,
      cancelled,
      running: false
    }
    const idx = this.entries.findIndex((e) => e.id === entry.id)
    if (idx >= 0) this.entries[idx] = done
    this.emit('entry', done)
  }

  list(): CommandLogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  private push(entry: CommandLogEntry): void {
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    this.emit('entry', entry)
  }
}

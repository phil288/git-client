import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { EventChannel, InvokeArgs, InvokeChannel, InvokeResult, IpcEventMap } from '@shared/ipc'
import type { IpcResult } from '@shared/types'
import { toErrorInfo } from './git/errors'

export type Handler<C extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: InvokeArgs<C>
) => InvokeResult<C> | Promise<InvokeResult<C>>

/**
 * Registers a typed handler. Every call is checked against the trusted
 * renderer origin, and every result is wrapped in IpcResult so errors
 * (including git's stderr) survive the process boundary intact.
 */
export function createRegistry(isTrustedSender: (event: IpcMainInvokeEvent) => boolean) {
  return function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<InvokeResult<C>>> => {
      if (!isTrustedSender(event)) {
        return { ok: false, error: { message: 'Untrusted IPC sender', code: 'INVALID_ARGUMENT' } }
      }
      try {
        const value = await handler(event, ...(args as InvokeArgs<C>))
        return { ok: true, value }
      } catch (err) {
        return { ok: false, error: toErrorInfo(err) }
      }
    })
  }
}

export function send<E extends EventChannel>(target: WebContents | null | undefined, event: E, payload: IpcEventMap[E]): void {
  if (target && !target.isDestroyed()) target.send(event, payload)
}

/** Runtime argument guards for values coming from the renderer. */
export const assert = {
  string(v: unknown, name: string): string {
    if (typeof v !== 'string') throw new TypeError(`${name} must be a string`)
    return v
  },
  nonEmptyString(v: unknown, name: string): string {
    const s = assert.string(v, name)
    if (s.trim() === '') throw new TypeError(`${name} must not be empty`)
    return s
  },
  boolean(v: unknown, name: string): boolean {
    if (typeof v !== 'boolean') throw new TypeError(`${name} must be a boolean`)
    return v
  },
  stringArray(v: unknown, name: string): string[] {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new TypeError(`${name} must be a string[]`)
    return v as string[]
  },
  nullableString(v: unknown, name: string): string | null {
    if (v === null) return null
    return assert.string(v, name)
  }
}

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Bridge, type EventChannel, type InvokeChannel } from '@shared/ipc'

const invokeAllowed = new Set<string>(INVOKE_CHANNELS)
const eventAllowed = new Set<string>(EVENT_CHANNELS)

/**
 * The only surface the renderer gets. It cannot reach ipcRenderer itself,
 * Node, or any channel outside the allowlists in @shared/ipc.
 */
const bridge: Bridge = {
  invoke(channel: InvokeChannel, ...args: unknown[]) {
    if (!invokeAllowed.has(channel)) return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on(event: EventChannel, listener: (payload: never) => void) {
    if (!eventAllowed.has(event)) throw new Error(`Blocked IPC event: ${event}`)
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(event, wrapped)
    return () => {
      ipcRenderer.removeListener(event, wrapped)
    }
  },
  getPathForFile(file: File) {
    return webUtils.getPathForFile(file)
  },
  platform: process.platform
} as Bridge

contextBridge.exposeInMainWorld('bridge', bridge)

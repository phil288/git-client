/// <reference types="vite/client" />
import type { Bridge } from '@shared/ipc'

declare global {
  interface Window {
    bridge: Bridge
  }
}

export {}

declare module 'monaco-codicon.css'

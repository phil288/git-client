import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function newId(): string {
  return crypto.randomUUID()
}

export const isMac = navigator.userAgent.includes('Mac')

/** Ctrl on Linux/Windows, Cmd on macOS. */
export function isPrimaryModifier(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}

import { relativeTime } from '@shared/display'
import { useAppStore } from '@/stores/app'

/** Formats a unix-seconds timestamp according to Settings → Date format. */
export function formatDate(unixSeconds: number, mode = useAppStore.getState().settings.dateFormat): string {
  const d = new Date(unixSeconds * 1000)
  if (mode === 'iso') return d.toISOString().slice(0, 16).replace('T', ' ')
  if (mode === 'absolute') return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const days = (Date.now() - d.getTime()) / 86_400_000
  return days < 7 ? relativeTime(d.getTime()) : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function absoluteDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })
}

export function shortHash(hash: string): string {
  return hash.slice(0, 8)
}

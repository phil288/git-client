import { relativeTime } from '@shared/display'
import { useAppStore } from '@/stores/app'

/**
 * `Date#toLocaleString(locale, options)` builds a new Intl.DateTimeFormat on
 * every call (~0.1 ms each); the log table formats two dates per visible row
 * per render, so the formatters are created once and reused.
 */
const MEDIUM_DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const MEDIUM_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const FULL_DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' })

/** Formats a unix-seconds timestamp according to Settings → Date format. */
export function formatDate(unixSeconds: number, mode = useAppStore.getState().settings.dateFormat): string {
  const ms = unixSeconds * 1000
  if (mode === 'iso') return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
  if (mode === 'absolute') return MEDIUM_DATE_TIME.format(ms)
  const days = (Date.now() - ms) / 86_400_000
  return days < 7 ? relativeTime(ms) : MEDIUM_DATE.format(ms)
}

export function absoluteDate(unixSeconds: number): string {
  return FULL_DATE_TIME.format(unixSeconds * 1000)
}

export function shortHash(hash: string): string {
  return hash.slice(0, 8)
}

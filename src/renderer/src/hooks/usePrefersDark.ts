import { useSyncExternalStore } from 'react'

const query = () => window.matchMedia('(prefers-color-scheme: dark)')

/** Follows the OS theme (or Settings → Theme, via nativeTheme.themeSource). */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = query()
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => query().matches
  )
}

export function useMonacoTheme(): string {
  return usePrefersDark() ? 'gitclient-dark' : 'gitclient-light'
}

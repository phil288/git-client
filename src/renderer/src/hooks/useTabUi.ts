import { useCallback } from 'react'
import { useTabsStore } from '@/stores/tabs'

/** One key of a tab's persisted UI state (selection, filters, pane sizes…). */
export function useTabUi<T>(tabId: string, key: string, fallback: T): [T, (value: T) => void] {
  const value = useTabsStore((s) => s.tabs.find((t) => t.id === tabId)?.ui[key]) as T | undefined
  const setUi = useTabsStore((s) => s.setUi)
  const set = useCallback((v: T) => setUi(tabId, { [key]: v }), [setUi, tabId, key])
  return [value === undefined ? fallback : value, set]
}

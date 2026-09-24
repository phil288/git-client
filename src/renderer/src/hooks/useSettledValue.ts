import { useEffect, useRef, useState } from 'react'

/**
 * Follows `value`, but while it changes faster than `ms` (holding an arrow key
 * in a list) only the value it settles on is passed through. An isolated change
 * (a click) goes through immediately, so single selections get no added delay.
 */
export function useSettledValue<T>(value: T, ms = 150): T {
  const [settled, setSettled] = useState(value)
  const lastChange = useRef(0)
  useEffect(() => {
    const now = performance.now()
    const rapid = now - lastChange.current < ms
    lastChange.current = now
    if (!rapid) {
      setSettled(value)
      return
    }
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

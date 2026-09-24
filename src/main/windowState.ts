export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Persisted main-window geometry. Bounds are the normal (un-maximized) ones. */
export interface WindowState {
  bounds: Rect | null
  maximized: boolean
}

export const DEFAULT_WINDOW_STATE: WindowState = { bounds: null, maximized: false }

/** Minimum visible overlap (px) with a display for saved bounds to be reused. */
const MIN_VISIBLE = 100

function overlap(a: Rect, b: Rect): { w: number; h: number } {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return { w: Math.max(0, w), h: Math.max(0, h) }
}

/**
 * Saved bounds to restore, or null to let Electron center a default-sized
 * window. Bounds that no longer land on any display's work area (monitor
 * unplugged, resolution changed) are dropped so the window never opens
 * off-screen.
 */
export function restorableBounds(saved: Rect | null, workAreas: Rect[], min: { width: number; height: number }): Rect | null {
  if (!saved) return null
  const values = [saved.x, saved.y, saved.width, saved.height]
  if (!values.every(Number.isFinite)) return null
  const visible = workAreas.some((area) => {
    const o = overlap(saved, area)
    return o.w >= Math.min(MIN_VISIBLE, saved.width) && o.h >= Math.min(MIN_VISIBLE, saved.height)
  })
  if (!visible) return null
  return {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width: Math.max(min.width, Math.round(saved.width)),
    height: Math.max(min.height, Math.round(saved.height))
  }
}

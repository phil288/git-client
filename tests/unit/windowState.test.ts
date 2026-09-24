import { describe, expect, it } from 'vitest'
import { restorableBounds } from '../../src/main/windowState'

const MIN = { width: 800, height: 500 }
const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const right = { x: 1920, y: 0, width: 2560, height: 1400 }

describe('restorableBounds', () => {
  it('returns null when nothing was saved', () => {
    expect(restorableBounds(null, [primary], MIN)).toBeNull()
  })

  it('keeps bounds that are on a display', () => {
    const b = { x: 100, y: 50, width: 1200, height: 800 }
    expect(restorableBounds(b, [primary], MIN)).toEqual(b)
    const onSecond = { x: 2000, y: 100, width: 1400, height: 900 }
    expect(restorableBounds(onSecond, [primary, right], MIN)).toEqual(onSecond)
  })

  it('drops bounds on a display that is gone', () => {
    expect(restorableBounds({ x: 2000, y: 100, width: 1400, height: 900 }, [primary], MIN)).toBeNull()
  })

  it('drops bounds that barely overlap any display', () => {
    expect(restorableBounds({ x: 1880, y: 0, width: 1000, height: 800 }, [primary], MIN)).toBeNull()
  })

  it('rejects non-finite values and enforces the minimum size', () => {
    expect(restorableBounds({ x: NaN, y: 0, width: 1000, height: 800 }, [primary], MIN)).toBeNull()
    expect(restorableBounds({ x: 10.4, y: 10.6, width: 300, height: 200 }, [primary], MIN)).toEqual({ x: 10, y: 11, width: 800, height: 500 })
  })
})

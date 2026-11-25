import { describe, expect, it } from 'vitest'
import { tableWindow } from './table'

describe('tableWindow', () => {
  it('renders every row for small libraries', () => {
    expect(tableWindow(10, 0, 400)).toEqual({ start: 0, end: 10, topSpacer: 0, bottomSpacer: 0 })
  })

  it('keeps a viewport window plus overscan and preserves numbering', () => {
    const window = tableWindow(1000, 3000, 300)
    expect(window.start).toBe(92)
    expect(window.end).toBeGreaterThan(window.start)
    expect(window.end).toBeLessThan(1000)
    expect(window.topSpacer).toBe(window.start * 30)
    expect(window.bottomSpacer).toBe((1000 - window.end) * 30)
    expect(window.topSpacer + (window.end - window.start) * 30 + window.bottomSpacer).toBe(1000 * 30)
  })

  it('clamps the window at the top and bottom of the scroll range', () => {
    expect(tableWindow(500, 0, 300).start).toBe(0)
    expect(tableWindow(500, 100_000, 300).end).toBe(500)
    expect(tableWindow(500, 100_000, 300).bottomSpacer).toBe(0)
  })
})

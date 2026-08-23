import { describe, expect, it } from 'vitest'
import { MIN_CANVAS_WIDTH, MIN_PANEL_WIDTH, clampPanelWidth } from './panel-width.ts'

describe('clampPanelWidth', () => {
  it('returns a width inside the band verbatim', () => {
    expect(clampPanelWidth(400, 1600)).toBe(400)
  })

  it('raises a width below the panel floor', () => {
    expect(clampPanelWidth(MIN_PANEL_WIDTH - 60, 1600)).toBe(MIN_PANEL_WIDTH)
    expect(clampPanelWidth(0, 1600)).toBe(MIN_PANEL_WIDTH)
  })

  it('cuts back a width that would leave the canvas less than its floor', () => {
    const available = 1200
    expect(clampPanelWidth(1100, available)).toBe(available - MIN_CANVAS_WIDTH)
  })

  it('keeps the widest width that still honours the canvas floor', () => {
    const available = 1200
    expect(clampPanelWidth(available - MIN_CANVAS_WIDTH, available)).toBe(
      available - MIN_CANVAS_WIDTH,
    )
  })

  it('gives the panel its floor when both floors cannot be honoured', () => {
    const available = MIN_PANEL_WIDTH + MIN_CANVAS_WIDTH - 100
    expect(clampPanelWidth(600, available)).toBe(MIN_PANEL_WIDTH)
    expect(clampPanelWidth(10, available)).toBe(MIN_PANEL_WIDTH)
  })
})

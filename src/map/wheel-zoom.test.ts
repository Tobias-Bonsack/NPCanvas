import { describe, expect, it } from 'vitest'
import type { WheelInput } from './wheel-zoom.ts'
import { normalizeDelta, wheelZoomFactor } from './wheel-zoom.ts'

function wheel(part: Partial<WheelInput>): WheelInput {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...part }
}

describe('normalizeDelta', () => {
  it('passes pixel deltas through on both axes', () => {
    expect(normalizeDelta(wheel({ deltaX: -30, deltaY: 12 }))).toEqual({ x: -30, y: 12 })
  })

  it('converts lines to pixels', () => {
    expect(normalizeDelta(wheel({ deltaX: 1, deltaY: -3, deltaMode: 1 }))).toEqual({
      x: 16,
      y: -48,
    })
  })

  it('converts pages to pixels', () => {
    expect(normalizeDelta(wheel({ deltaX: 2, deltaY: 1, deltaMode: 2 }))).toEqual({
      x: 800,
      y: 400,
    })
  })

  it('treats an unknown deltaMode as pixels rather than guessing', () => {
    expect(normalizeDelta(wheel({ deltaY: 7, deltaMode: 99 }))).toEqual({ x: 0, y: 7 })
  })

  it('reports a horizontal-only flick, which is the case deltaY alone lost entirely', () => {
    expect(normalizeDelta(wheel({ deltaX: 40 }))).toEqual({ x: 40, y: 0 })
  })
})

describe('wheelZoomFactor', () => {
  it('grows the scale scrolling up and shrinks it scrolling down', () => {
    expect(wheelZoomFactor(wheel({ deltaY: -10, ctrlKey: true }))).toBeGreaterThan(1)
    expect(wheelZoomFactor(wheel({ deltaY: 10, ctrlKey: true }))).toBeLessThan(1)
  })

  it('is exactly 1 for a wheel event that moved nothing', () => {
    expect(wheelZoomFactor(wheel({}))).toBe(1)
  })

  it('is a ratio: two notches are one notch squared, at any scale', () => {
    const one = wheelZoomFactor(wheel({ deltaY: -10, ctrlKey: true }))
    const two = wheelZoomFactor(wheel({ deltaY: -20, ctrlKey: true }))
    expect(two).toBeCloseTo(one * one, 10)
  })

  it('is exactly reciprocal in the two directions, so a notch back undoes a notch', () => {
    const out = wheelZoomFactor(wheel({ deltaY: 24, ctrlKey: true }))
    const back = wheelZoomFactor(wheel({ deltaY: -24, ctrlKey: true }))
    expect(out * back).toBeCloseTo(1, 10)
  })

  it('does not depend on ctrlKey — which branch zooms is the caller’s decision', () => {
    expect(wheelZoomFactor(wheel({ deltaY: -10, ctrlKey: true }))).toBe(
      wheelZoomFactor(wheel({ deltaY: -10, ctrlKey: false })),
    )
  })

  it('reads a line-mode pinch through the same conversion, not as raw units', () => {
    expect(wheelZoomFactor(wheel({ deltaY: -1, deltaMode: 1, ctrlKey: true }))).toBe(
      wheelZoomFactor(wheel({ deltaY: -16, deltaMode: 0, ctrlKey: true })),
    )
  })

  it('reads a page-mode pinch through the same conversion', () => {
    expect(wheelZoomFactor(wheel({ deltaY: -1, deltaMode: 2, ctrlKey: true }))).toBe(
      wheelZoomFactor(wheel({ deltaY: -400, deltaMode: 0, ctrlKey: true })),
    )
  })
})

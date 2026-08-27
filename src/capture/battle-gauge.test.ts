import { describe, expect, it } from 'vitest'
import type { PixelRect } from '../project/types.ts'
import { battleGaugeVisible } from './battle-gauge.ts'
import type { PixelBuffer } from './glyph-matcher.ts'

type Rgb = readonly [number, number, number]

const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [248, 248, 248]
const GREEN: Rgb = [3, 245, 3]
const RED: Rgb = [248, 9, 8]
const PURPLE: Rgb = [168, 120, 200]
const DARK_PURPLE: Rgb = [96, 64, 128]

/** The rectangle the calibration step would produce around the gauge below. */
const RECT: PixelRect = { x: 30, y: 16, width: 56, height: 8 }

function blank(fill: Rgb = WHITE): PixelBuffer {
  const width = 160
  const height = 144
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = fill[0]
    data[index * 4 + 1] = fill[1]
    data[index * 4 + 2] = fill[2]
    data[index * 4 + 3] = 255
  }
  return { width, height, data }
}

function paint(buffer: PixelBuffer, x: number, y: number, width: number, colour: Rgb): void {
  for (let step = 0; step < width; step++) {
    const offset = (y * buffer.width + x + step) * 4
    buffer.data[offset] = colour[0]
    buffer.data[offset + 1] = colour[1]
    buffer.data[offset + 2] = colour[2]
  }
}

/**
 * The opponent gauge as the console draws it: a dark rule, two rows of bar then track, a dark
 * rule. `barWidth` is how much health is left; `ruleWidth` and `gap` exist so the boundary cases
 * can be built from the same shape rather than by hand.
 */
function gauge(options?: {
  barWidth?: number
  barColour?: Rgb
  ruleWidth?: number
  gap?: number
}): PixelBuffer {
  const barWidth = options?.barWidth ?? 48
  const barColour = options?.barColour ?? GREEN
  const ruleWidth = options?.ruleWidth ?? 52
  const gap = options?.gap ?? 3
  const buffer = blank()
  paint(buffer, 33, 18, ruleWidth, BLACK)
  for (let row = 1; row < gap; row++) {
    paint(buffer, 33, 18 + row, 1, BLACK)
    paint(buffer, 34, 18 + row, barWidth, barColour)
    paint(buffer, 34 + barWidth, 18 + row, 50 - barWidth, WHITE)
    paint(buffer, 84, 18 + row, 1, BLACK)
  }
  paint(buffer, 33, 18 + gap, ruleWidth, BLACK)
  return buffer
}

describe('battleGaugeVisible', () => {
  it('sees a full gauge', () => {
    expect(battleGaugeVisible(gauge(), RECT)).toBe(true)
  })

  it('sees a gauge whose bar is nearly gone', () => {
    // The bar is what shrinks; the rules that frame it do not, which is why the test is the frame.
    expect(battleGaugeVisible(gauge({ barWidth: 4, barColour: RED }), RECT)).toBe(true)
  })

  it('sees no gauge on an empty screen', () => {
    expect(battleGaugeVisible(blank(), RECT)).toBe(false)
  })

  it('sees no gauge in a flat saturated fill', () => {
    // The town map: green from edge to edge. This is the case the colour test got wrong.
    expect(battleGaugeVisible(blank(GREEN), RECT)).toBe(false)
  })

  it('sees no gauge in a striped fill', () => {
    // A purple library interior: banded, but never a dark rule with a light track under it.
    const buffer = blank(PURPLE)
    for (let y = 16; y < 24; y += 2) paint(buffer, 0, y, 160, DARK_PURPLE)
    expect(battleGaugeVisible(buffer, RECT)).toBe(false)
  })

  it('sees no gauge in a solid dark block', () => {
    // Its own top and bottom edges are two dark rules the right distance apart. What it has not
    // got is a light track between them.
    const buffer = blank()
    for (let y = 17; y <= 21; y++) paint(buffer, 30, y, 56, BLACK)
    expect(battleGaugeVisible(buffer, RECT)).toBe(false)
  })

  it('sees no gauge when the rules are too short', () => {
    expect(battleGaugeVisible(gauge({ ruleWidth: 16, barWidth: 14 }), RECT)).toBe(false)
  })

  it('sees no gauge when the rules are too far apart', () => {
    expect(battleGaugeVisible(gauge({ gap: 5 }), RECT)).toBe(false)
  })

  it('sees no gauge through a rectangle narrower than a rule', () => {
    expect(battleGaugeVisible(gauge(), { x: 33, y: 16, width: 20, height: 8 })).toBe(false)
  })

  it('clamps a rectangle that runs off the frame', () => {
    expect(battleGaugeVisible(gauge(), { x: 130, y: 138, width: 200, height: 200 })).toBe(false)
  })
})

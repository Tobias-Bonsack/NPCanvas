import { describe, expect, it } from 'vitest'
import { asCaptureProfileId } from '../project/ids.ts'
import type { CaptureProfile } from '../project/types.ts'
import type { ScreenMapping } from './capture-profile.ts'
import {
  DEFAULT_NATIVE_HEIGHT,
  DEFAULT_NATIVE_WIDTH,
  frameToNative,
  nativeToFrame,
  profileApplies,
  rectFromCorners,
  snapToTileGrid,
  tileStep,
} from './capture-profile.ts'

/** A Game Boy screen letterboxed into a window, at 2.625 × horizontally and 2.5 × vertically. */
const MAPPING: ScreenMapping = {
  screenRect: { x: 37.5, y: 91, width: 420, height: 360 },
  nativeWidth: DEFAULT_NATIVE_WIDTH,
  nativeHeight: DEFAULT_NATIVE_HEIGHT,
}

const NATIVE_BOUNDS = { width: DEFAULT_NATIVE_WIDTH, height: DEFAULT_NATIVE_HEIGHT }

function profile(overrides: Partial<CaptureProfile> = {}): CaptureProfile {
  return {
    id: asCaptureProfileId('profile-1'),
    name: 'Pokémon Red',
    frameWidth: 1998,
    frameHeight: 1123,
    ...MAPPING,
    textRect: { x: 8, y: 96, width: 144, height: 40 },
    glyphs: [],
    ...overrides,
  }
}

describe('snapToTileGrid', () => {
  it('grows a sloppy rectangle outwards to whole tiles', () => {
    expect(snapToTileGrid({ x: 9, y: 97, width: 130, height: 30 }, NATIVE_BOUNDS)).toEqual({
      x: 8,
      y: 96,
      width: 136,
      height: 32,
    })
  })

  it('leaves a rectangle already on the grid alone', () => {
    const rect = { x: 8, y: 96, width: 144, height: 40 }
    expect(snapToTileGrid(rect, NATIVE_BOUNDS)).toEqual(rect)
  })

  it('clamps a rectangle dragged off the top-left edge', () => {
    expect(snapToTileGrid({ x: -30, y: -5, width: 50, height: 20 }, NATIVE_BOUNDS)).toEqual({
      x: 0,
      y: 0,
      width: 24,
      height: 16,
    })
  })

  it('clamps a rectangle dragged past the bottom-right edge', () => {
    expect(snapToTileGrid({ x: 140, y: 130, width: 90, height: 60 }, NATIVE_BOUNDS)).toEqual({
      x: 136,
      y: 128,
      width: 24,
      height: 16,
    })
  })

  it('never returns less than one tile', () => {
    expect(snapToTileGrid({ x: 20, y: 20, width: 0, height: 0 }, NATIVE_BOUNDS)).toEqual({
      x: 16,
      y: 16,
      width: 8,
      height: 8,
    })
  })

  it('normalizes a rectangle dragged up and to the left', () => {
    expect(snapToTileGrid({ x: 64, y: 64, width: -40, height: -40 }, NATIVE_BOUNDS)).toEqual({
      x: 24,
      y: 24,
      width: 40,
      height: 40,
    })
  })

  it('drops a ragged last column when the native size is not a multiple of a tile', () => {
    expect(snapToTileGrid({ x: 60, y: 0, width: 20, height: 10 }, { width: 68, height: 68 })).toEqual({
      x: 56,
      y: 0,
      width: 8,
      height: 16,
    })
  })
})

describe('nativeToFrame / frameToNative', () => {
  it('places the native origin at the screen rect', () => {
    expect(nativeToFrame(MAPPING, { x: 0, y: 0, width: 160, height: 144 })).toEqual({
      x: 37.5,
      y: 91,
      width: 420,
      height: 360,
    })
  })

  it('round trips at a non-integer scale', () => {
    const rect = { x: 8, y: 96, width: 144, height: 40 }
    const back = frameToNative(MAPPING, nativeToFrame(MAPPING, rect))
    expect(back.x).toBeCloseTo(rect.x, 10)
    expect(back.y).toBeCloseTo(rect.y, 10)
    expect(back.width).toBeCloseTo(rect.width, 10)
    expect(back.height).toBeCloseTo(rect.height, 10)
  })

  it('steps the tile grid by whole tiles in frame pixels', () => {
    expect(tileStep(MAPPING)).toEqual({ x: 21, y: 20 })
  })
})

describe('profileApplies', () => {
  it('accepts the frame size it was calibrated against', () => {
    expect(profileApplies(profile(), 1998, 1123)).toBe(true)
  })

  it('rejects any other frame size, one pixel included', () => {
    expect(profileApplies(profile(), 1998, 1124)).toBe(false)
    expect(profileApplies(profile(), 1920, 1080)).toBe(false)
  })
})

describe('rectFromCorners', () => {
  it('is direction-independent', () => {
    const forwards = rectFromCorners({ x: 10, y: 20 }, { x: 40, y: 60 })
    const backwards = rectFromCorners({ x: 40, y: 60 }, { x: 10, y: 20 })
    expect(forwards).toEqual({ x: 10, y: 20, width: 30, height: 40 })
    expect(backwards).toEqual(forwards)
  })
})

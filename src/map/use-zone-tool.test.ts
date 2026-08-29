import { describe, expect, it } from 'vitest'
import { asMapId, asZoneId } from '../project/ids.ts'
import type { GameMap, Zone } from '../project/types.ts'
import { rectToPolygon } from './geometry.ts'
import type { Viewport } from './viewport.ts'
import { MIN_ZONE_SIZE, handleAtCanvasPoint, meetsMinZoneSize } from './use-zone-tool.ts'

const MAP_ID = asMapId('overworld')

/** Origin at the canvas origin, native scale — canvas points equal map-local points. */
const NATIVE_MAP: GameMap = {
  id: MAP_ID,
  name: 'Overworld',
  file: { fileName: 'overworld.png', mimeType: 'image/png', byteSize: 10 },
  width: 400,
  height: 300,
  origin: { x: 0, y: 0 },
  scale: 1,
}

const ZONE: Zone = {
  id: asZoneId('town'),
  mapId: MAP_ID,
  name: 'Town',
  polygon: rectToPolygon({ x: 10, y: 20, width: 100, height: 50 }),
  hue: 200,
}

const IDENTITY_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }

describe('handleAtCanvasPoint', () => {
  it('finds a grip of the selected zone near a canvas point', () => {
    expect(
      handleAtCanvasPoint({ x: 112, y: 22 }, { zone: ZONE, map: NATIVE_MAP }, IDENTITY_VIEWPORT),
    ).toEqual({ zone: ZONE, map: NATIVE_MAP, handle: 'ne' })
  })

  it('returns null when nothing is selected', () => {
    expect(handleAtCanvasPoint({ x: 112, y: 22 }, null, IDENTITY_VIEWPORT)).toBe(null)
  })

  it('returns null for a press away from every grip', () => {
    expect(
      handleAtCanvasPoint({ x: 60, y: 45 }, { zone: ZONE, map: NATIVE_MAP }, IDENTITY_VIEWPORT),
    ).toBe(null)
  })

  it('shrinks the hit radius as the canvas zooms in, so the grab area stays constant on screen', () => {
    // At 8x zoom, a screen-constant hit radius covers far fewer canvas units — a press that
    // was a hit at 1x now overshoots the grip.
    const zoomedIn: Viewport = { x: 0, y: 0, scale: 8 }
    expect(
      handleAtCanvasPoint({ x: 112, y: 22 }, { zone: ZONE, map: NATIVE_MAP }, zoomedIn),
    ).toBe(null)
    // But the grip itself is still exactly where it was.
    expect(
      handleAtCanvasPoint({ x: 110, y: 20 }, { zone: ZONE, map: NATIVE_MAP }, zoomedIn),
    ).toEqual({ zone: ZONE, map: NATIVE_MAP, handle: 'ne' })
  })

  it('converts the canvas point through the map before hit-testing, for a map not at native placement', () => {
    const placed: GameMap = { ...NATIVE_MAP, origin: { x: 1000, y: 500 }, scale: 2 }
    // The zone's `ne` grip at map-local (110, 20) lands at canvas (1000 + 110*2, 500 + 20*2).
    expect(
      handleAtCanvasPoint({ x: 1220, y: 540 }, { zone: ZONE, map: placed }, IDENTITY_VIEWPORT),
    ).toEqual({ zone: ZONE, map: placed, handle: 'ne' })
  })
})

describe('meetsMinZoneSize', () => {
  it('rejects a rectangle narrower than MIN_ZONE_SIZE screen pixels on either axis', () => {
    const tooNarrow = { x: 0, y: 0, width: MIN_ZONE_SIZE - 1, height: 100 }
    expect(meetsMinZoneSize(tooNarrow, IDENTITY_VIEWPORT, NATIVE_MAP)).toBe(false)
    const tooShort = { x: 0, y: 0, width: 100, height: MIN_ZONE_SIZE - 1 }
    expect(meetsMinZoneSize(tooShort, IDENTITY_VIEWPORT, NATIVE_MAP)).toBe(false)
  })

  it('accepts a rectangle exactly at the minimum on both axes', () => {
    const minimum = { x: 0, y: 0, width: MIN_ZONE_SIZE, height: MIN_ZONE_SIZE }
    expect(meetsMinZoneSize(minimum, IDENTITY_VIEWPORT, NATIVE_MAP)).toBe(true)
  })

  it('judges by screen size, not map-local size — a zoomed-out draw needs more map pixels', () => {
    const zoomedOut: Viewport = { x: 0, y: 0, scale: 0.5 }
    // MIN_ZONE_SIZE map-local pixels only cover half that on screen at 0.5x.
    const rect = { x: 0, y: 0, width: MIN_ZONE_SIZE, height: MIN_ZONE_SIZE }
    expect(meetsMinZoneSize(rect, zoomedOut, NATIVE_MAP)).toBe(false)
    const bigEnough = { x: 0, y: 0, width: MIN_ZONE_SIZE * 2, height: MIN_ZONE_SIZE * 2 }
    expect(meetsMinZoneSize(bigEnough, zoomedOut, NATIVE_MAP)).toBe(true)
  })
})

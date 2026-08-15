import { describe, expect, it } from 'vitest'
import { asMapId, asZoneId } from '../project/ids.ts'
import type { MapId, Zone } from '../project/types.ts'
import { ZONE_HUES, nextZoneHue } from './zone-style.ts'

function zone(id: string, mapId: MapId, hue: number): Zone {
  return {
    id: asZoneId(id),
    mapId,
    name: id,
    polygon: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    hue,
  }
}

const HARBOUR = asMapId('harbour')
const CAVES = asMapId('caves')

describe('nextZoneHue', () => {
  it('hands out the palette in order while it lasts', () => {
    expect(nextZoneHue([], HARBOUR)).toBe(ZONE_HUES[0])
    expect(nextZoneHue([zone('a', HARBOUR, ZONE_HUES[0])], HARBOUR)).toBe(ZONE_HUES[1])
    expect(
      nextZoneHue([zone('a', HARBOUR, ZONE_HUES[0]), zone('b', HARBOUR, ZONE_HUES[1])], HARBOUR),
    ).toBe(ZONE_HUES[2])
  })

  it('fills a gap left by a deleted zone rather than skipping past it', () => {
    const zones = [zone('a', HARBOUR, ZONE_HUES[0]), zone('c', HARBOUR, ZONE_HUES[2])]
    expect(nextZoneHue(zones, HARBOUR)).toBe(ZONE_HUES[1])
  })

  it('is scoped per map, so a second map starts from the top of the palette', () => {
    const zones = [zone('a', HARBOUR, ZONE_HUES[0]), zone('b', HARBOUR, ZONE_HUES[1])]
    expect(nextZoneHue(zones, CAVES)).toBe(ZONE_HUES[0])
  })

  it('wraps once every hue on the map is taken', () => {
    const zones = ZONE_HUES.map((hue, index) => zone(`z${index}`, HARBOUR, hue))
    expect(ZONE_HUES).toContain(nextZoneHue(zones, HARBOUR))
  })

  it('ignores a hue no palette entry uses, which an older document may carry', () => {
    expect(nextZoneHue([zone('a', HARBOUR, 17)], HARBOUR)).toBe(ZONE_HUES[0])
  })
})

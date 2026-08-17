import { describe, expect, it } from 'vitest'
import { asMapId, asZoneId } from '../project/ids.ts'
import type { MapId, Zone } from '../project/types.ts'
import { nextZoneName } from './zone-name.ts'

function zone(id: string, mapId: MapId, name: string): Zone {
  return {
    id: asZoneId(id),
    mapId,
    name,
    polygon: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    hue: 200,
  }
}

const HARBOUR = asMapId('harbour')
const CAVES = asMapId('caves')

describe('nextZoneName', () => {
  it('counts up from one on an empty map', () => {
    expect(nextZoneName([], HARBOUR)).toBe('Zone 1')
    expect(nextZoneName([zone('a', HARBOUR, 'Zone 1')], HARBOUR)).toBe('Zone 2')
  })

  it('fills the gap a deleted zone left instead of colliding with a later one', () => {
    const zones = [zone('a', HARBOUR, 'Zone 1'), zone('c', HARBOUR, 'Zone 3')]
    expect(nextZoneName(zones, HARBOUR)).toBe('Zone 2')
  })

  it('skips past renamed zones, which occupy no number', () => {
    const zones = [zone('a', HARBOUR, 'Docks'), zone('b', HARBOUR, 'Zone 1')]
    expect(nextZoneName(zones, HARBOUR)).toBe('Zone 2')
  })

  it('is scoped per map, so a second map starts from one again', () => {
    const zones = [zone('a', HARBOUR, 'Zone 1'), zone('b', HARBOUR, 'Zone 2')]
    expect(nextZoneName(zones, CAVES)).toBe('Zone 1')
  })

  it('never repeats a name already on the map', () => {
    const zones = [zone('a', HARBOUR, 'Zone 1'), zone('b', HARBOUR, 'Zone 2')]
    const grown = [...zones, zone('c', HARBOUR, nextZoneName(zones, HARBOUR))]
    expect(new Set(grown.map((z) => z.name)).size).toBe(grown.length)
  })
})

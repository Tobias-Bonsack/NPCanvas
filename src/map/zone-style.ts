import type { CSSProperties } from 'react'
import type { MapId, Zone } from '../project/types.ts'

// Spread apart and ordered so the first few zones drawn are maximally distinct.
export const ZONE_HUES = [200, 25, 140, 320, 55, 265, 0, 170, 100, 300, 80, 230] as const

// Per map, not per project — two maps never share a screen region, so reuse costs nothing and
// scoping project-wide would exhaust the palette on the second map. Wraps once exhausted.
export function nextZoneHue(zones: readonly Zone[], mapId: MapId): number {
  const used = new Set<number>()
  for (const zone of zones) {
    if (zone.mapId === mapId) used.add(zone.hue)
  }
  return ZONE_HUES.find((hue) => !used.has(hue)) ?? ZONE_HUES[used.size % ZONE_HUES.length]
}

// Fill, stroke and swatch are all built from this custom property at different alphas in CSS,
// rather than three colour strings that could drift apart.
export function zoneHueStyle(hue: number): CSSProperties & Record<'--zone-hue', string> {
  return { '--zone-hue': String(hue) }
}

import type { CSSProperties } from 'react'
import type { MapId, Zone } from '../project/types.ts'

/**
 * The hues a new zone is drawn from, in the order they are handed out. Spread far enough
 * apart that neighbouring zones on one map never read as the same colour, and ordered so the
 * first few zones a user draws are maximally distinct rather than adjacent on the wheel.
 */
export const ZONE_HUES = [200, 25, 140, 320, 55, 265, 0, 170, 100, 300, 80, 230] as const

/**
 * A hue no zone on this map is already using, where one is left. Per map, not per project:
 * two maps never share a screen region, so reusing a hue across them costs nothing, and
 * scoping it project-wide would exhaust the palette on the second map.
 *
 * Once every hue is taken the palette simply wraps — a duplicate colour is worse than no
 * colour only if it is the *only* thing distinguishing two zones, and the name always is.
 */
export function nextZoneHue(zones: readonly Zone[], mapId: MapId): number {
  const used = new Set<number>()
  for (const zone of zones) {
    if (zone.mapId === mapId) used.add(zone.hue)
  }
  return ZONE_HUES.find((hue) => !used.has(hue)) ?? ZONE_HUES[used.size % ZONE_HUES.length]
}

/**
 * A zone's hue as an inherited custom property. The fill, the stroke and the list swatch are
 * all built from it in CSS at different alphas, which is one declaration here instead of
 * three colour strings that could drift apart.
 *
 * The intersection type is how the custom property reaches `style` without an `as` cast:
 * `CSSProperties` alone has no index signature for `--*`.
 */
export function zoneHueStyle(hue: number): CSSProperties & Record<'--zone-hue', string> {
  return { '--zone-hue': String(hue) }
}

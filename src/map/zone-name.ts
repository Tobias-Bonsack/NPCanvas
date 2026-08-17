import type { MapId, Zone } from '../project/types.ts'

/**
 * The name a newly drawn zone gets: the lowest `Zone <n>` no zone on this map is already
 * called. Counting the zones and adding one collides as soon as anything has been deleted —
 * draw three, delete "Zone 2", draw again, and there are two zones called "Zone 2".
 *
 * Per map, like `nextZoneHue`, because a name only has to distinguish a zone from the others
 * a user sees beside it.
 */
export function nextZoneName(zones: readonly Zone[], mapId: MapId): string {
  const taken = new Set<string>()
  for (const zone of zones) {
    if (zone.mapId === mapId) taken.add(zone.name)
  }

  // Bounded rather than an open loop: `taken` holds at most `taken.size` of the candidates
  // `Zone 1`…`Zone taken.size + 1`, so one of them is always free.
  for (let n = 1; n <= taken.size; n += 1) {
    const name = `Zone ${n}`
    if (!taken.has(name)) return name
  }
  return `Zone ${taken.size + 1}`
}

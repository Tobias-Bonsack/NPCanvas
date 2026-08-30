import type { MapId, Zone } from '../project/types.ts'

// Lowest "Zone <n>" not already taken on this map — counting and adding one would collide as
// soon as anything's been deleted.
export function nextZoneName(zones: readonly Zone[], mapId: MapId): string {
  const taken = new Set<string>()
  for (const zone of zones) {
    if (zone.mapId === mapId) taken.add(zone.name)
  }

  for (let n = 1; n <= taken.size; n += 1) {
    const name = `Zone ${n}`
    if (!taken.has(name)) return name
  }
  return `Zone ${taken.size + 1}`
}

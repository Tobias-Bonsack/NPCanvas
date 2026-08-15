import type { Dialogue, DialogueId, MapId, Zone, ZoneId } from '../project/types.ts'
import { pointInPolygon, polygonArea, polygonBounds, rectContains } from './geometry.ts'

/**
 * Which zones each dialogue falls inside, derived from the geometry on every read.
 *
 * A `Dialogue` carries no `zoneId` and never will: a stored association would go stale the
 * moment a zone moved, and staleness that only shows up later is worse than recomputing.
 * See CLAUDE.md § Domain and architecture decisions.
 *
 * Membership is a **list**, because zones may overlap — a shop drawn inside a town — and it
 * is ordered by ascending area, so the most specific zone comes first and callers can take
 * `[0]` as the primary location without knowing anything about the sorting rule.
 *
 * A dialogue is only ever matched against zones on its own map: map-local coordinates from
 * two different maps are unrelated numbers, and comparing them would place pins in regions
 * they have never been near.
 *
 * Every dialogue gets an entry, including an empty one — "outside any zone" is an answer, and
 * a missing key would make callers unable to tell it from a dialogue this index never saw.
 */
export function indexDialoguesByZone(
  dialogues: readonly Dialogue[],
  zones: readonly Zone[],
): ReadonlyMap<DialogueId, ZoneId[]> {
  const byMap = groupZonesByMap(zones)
  const index = new Map<DialogueId, ZoneId[]>()

  for (const dialogue of dialogues) {
    const candidates = byMap.get(dialogue.mapId) ?? []
    const hits: ZoneId[] = []
    for (const candidate of candidates) {
      // The bounding box rejects the overwhelming majority for a quarter of the work of the
      // ray cast, which matters here: this is O(dialogues x zones) on every state change.
      if (!rectContains(candidate.bounds, dialogue.position)) continue
      if (!pointInPolygon(dialogue.position, candidate.zone.polygon)) continue
      hits.push(candidate.zone.id)
    }
    index.set(dialogue.id, hits)
  }
  return index
}

/**
 * How many dialogues each zone contains. A dialogue inside two overlapping zones counts for
 * both — "dialogues in this zone" is the question a count answers, not "dialogues this zone
 * owns", which nothing does.
 *
 * Derived from the index rather than from the geometry a second time, so the count and the
 * label a dialogue shows can never disagree.
 */
export function countDialoguesByZone(
  index: ReadonlyMap<DialogueId, ZoneId[]>,
): ReadonlyMap<ZoneId, number> {
  const counts = new Map<ZoneId, number>()
  for (const zoneIds of index.values()) {
    for (const zoneId of zoneIds) counts.set(zoneId, (counts.get(zoneId) ?? 0) + 1)
  }
  return counts
}

/** The dialogues inside one zone, as a set — the dimming test for the pin layer. */
export function dialoguesInZone(
  index: ReadonlyMap<DialogueId, ZoneId[]>,
  zoneId: ZoneId,
): ReadonlySet<DialogueId> {
  const inside = new Set<DialogueId>()
  for (const [dialogueId, zoneIds] of index) {
    if (zoneIds.includes(zoneId)) inside.add(dialogueId)
  }
  return inside
}

type ZoneCandidate = { zone: Zone; bounds: ReturnType<typeof polygonBounds> }

/**
 * Zones bucketed by map and sorted smallest-area-first, once per index build. Sorting here
 * rather than per dialogue is what makes the hit list come out ordered for free — the area of
 * a polygon is the same whichever dialogue is being tested against it.
 */
function groupZonesByMap(zones: readonly Zone[]): ReadonlyMap<MapId, ZoneCandidate[]> {
  const byArea = [...zones].sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))
  const byMap = new Map<MapId, ZoneCandidate[]>()
  for (const zone of byArea) {
    const candidate: ZoneCandidate = { zone, bounds: polygonBounds(zone.polygon) }
    const bucket = byMap.get(zone.mapId)
    if (bucket === undefined) byMap.set(zone.mapId, [candidate])
    else bucket.push(candidate)
  }
  return byMap
}

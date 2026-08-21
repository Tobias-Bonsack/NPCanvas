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
  if (cached !== null && cached.dialogues === dialogues && cached.zones === zones) {
    return cached.index
  }
  const index = buildIndex(dialogues, zones)
  cached = { dialogues, zones, index }
  return index
}

/**
 * The last index built and what it was built from.
 *
 * The canvas, the quest board and the insights screen all ask the same question of the same two
 * arrays, and `App` unmounts the view on every route change — so without this, navigating
 * Canvas → Insights → Canvas rebuilds an O(dialogues x zones) index from scratch, three times,
 * for a document that never changed. One slot rather than a keyed cache: the question is always
 * "the document as it is now", and a second entry could only ever describe one already gone.
 *
 * Identity, never value: the reducer returns the same array reference for an edit that changed
 * nothing, and builds a new one for every edit that did. That is exactly the test wanted here.
 */
let cached: {
  dialogues: readonly Dialogue[]
  zones: readonly Zone[]
  index: ReadonlyMap<DialogueId, ZoneId[]>
} | null = null

function buildIndex(
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
 * The index again, with one zone's membership re-tested and nothing else touched.
 *
 * A zone drag rebuilds the index on every frame, and a full build is O(dialogues x zones) with
 * a ray cast per candidate. Only one polygon moved, so only one question changed: is this
 * dialogue inside *that* zone now. Every other zone's answer for that dialogue is the one the
 * previous index already holds, and dialogues on other maps could never have been affected.
 *
 * The result is identical to `indexDialoguesByZone(dialogues, zones)` for the same input, which
 * `zone-index.test.ts` pins — an optimisation that may silently disagree with the definition is
 * worse than the cost it saves. It returns `previous` itself when no membership changed, so a
 * zone dragged through empty space costs the callers downstream nothing at all.
 *
 * Falls back to a full build when `previous` cannot be trusted to describe the same input: a
 * zone id that names nothing, or a dialogue the previous index never saw.
 */
export function reindexMovedZone(
  previous: ReadonlyMap<DialogueId, ZoneId[]>,
  dialogues: readonly Dialogue[],
  zones: readonly Zone[],
  movedId: ZoneId,
): ReadonlyMap<DialogueId, ZoneId[]> {
  const moved = zones.find((zone) => zone.id === movedId)
  if (moved === undefined) return indexDialoguesByZone(dialogues, zones)

  // The map's own candidates, already area-sorted and already carrying their bounds, from the
  // same cache a full build reads. A zone's position in that list *is* its rank, so an id that
  // has to go back into a dialogue's list lands where a full build would have put it — the
  // ordering rule stays in one place and this obeys the same one.
  const candidates = groupZonesByMap(zones).get(moved.mapId) ?? []
  const rank = new Map(candidates.map((candidate, index) => [candidate.zone.id, index]))
  const bounds =
    candidates.find((candidate) => candidate.zone.id === movedId)?.bounds ??
    polygonBounds(moved.polygon)

  const next = new Map<DialogueId, ZoneId[]>()
  let changed = false

  for (const dialogue of dialogues) {
    const before = previous.get(dialogue.id)
    if (before === undefined) return indexDialoguesByZone(dialogues, zones)

    if (dialogue.mapId !== moved.mapId) {
      next.set(dialogue.id, before)
      continue
    }

    const inside =
      rectContains(bounds, dialogue.position) && pointInPolygon(dialogue.position, moved.polygon)
    const was = before.includes(movedId)
    if (inside === was) {
      next.set(dialogue.id, before)
      continue
    }

    changed = true
    next.set(dialogue.id, inside ? withZone(before, movedId, rank) : without(before, movedId))
  }

  return changed ? next : previous
}

/** The list with `zoneId` inserted where its area puts it, leaving the rest in place. */
function withZone(
  zoneIds: readonly ZoneId[],
  zoneId: ZoneId,
  rank: ReadonlyMap<ZoneId, number>,
): ZoneId[] {
  const mine = rank.get(zoneId) ?? 0
  const at = zoneIds.findIndex((other) => (rank.get(other) ?? 0) > mine)
  const next = [...zoneIds]
  next.splice(at === -1 ? next.length : at, 0, zoneId)
  return next
}

function without(zoneIds: readonly ZoneId[], zoneId: ZoneId): ZoneId[] {
  return zoneIds.filter((other) => other !== zoneId)
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
  if (cachedCandidates !== null && cachedCandidates.zones === zones) return cachedCandidates.byMap
  const byMap = buildCandidates(zones)
  cachedCandidates = { zones, byMap }
  return byMap
}

/**
 * The sort, kept for as long as the zones are the same array. Sorting is the expensive half of
 * a build for an unchanged zone set, and a zone drag asks for the same set once per frame.
 */
let cachedCandidates: { zones: readonly Zone[]; byMap: ReadonlyMap<MapId, ZoneCandidate[]> } | null =
  null

function buildCandidates(zones: readonly Zone[]): ReadonlyMap<MapId, ZoneCandidate[]> {
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

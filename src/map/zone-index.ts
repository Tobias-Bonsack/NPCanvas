import type { Dialogue, DialogueId, GameMap, MapId, Point, Zone, ZoneId } from '../project/types.ts'
import { canvasToMapLocal, mapCanvasRect, mapLocalToCanvas, zoneCanvasRect } from './canvas-layout.ts'
import type { Rect } from './geometry.ts'
import {
  pointInPolygon,
  polygonArea,
  polygonBounds,
  rectContains,
  rectsOverlap,
} from './geometry.ts'

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
 * Membership is decided in **canvas** space, not map-local, which is why `maps` is an argument.
 * A house interior imported as its own map and dropped onto the town it stands in is a map lying
 * over another map's zone, and a line heard inside it was heard in that town — answering
 * "outside any zone" there would be wrong about the world the user is logging. Map-local
 * coordinates from two maps are unrelated numbers on their own; a map's `origin` and `scale` are
 * exactly what relates them, so the pin goes up into canvas space once and back down into each
 * candidate zone's own space, leaving the stored polygons untouched. The ordering is by canvas
 * area for the same reason — "smallest wins" has to mean the same thing across two maps whose
 * `scale` differs.
 *
 * A click is deliberately *not* resolved this way: `zoneAtCanvasPoint` consults only the topmost
 * map at the point. Belonging is geometric — a pin lies in a region whatever is drawn over it —
 * while a click means what the user can see, and selecting a zone through the map covering it
 * would be unaccountable.
 *
 * Every dialogue gets an entry, including an empty one — "outside any zone" is an answer, and
 * a missing key would make callers unable to tell it from a dialogue this index never saw.
 */
export function indexDialoguesByZone(
  dialogues: readonly Dialogue[],
  zones: readonly Zone[],
  maps: readonly GameMap[],
): ReadonlyMap<DialogueId, ZoneId[]> {
  if (
    cached !== null &&
    cached.dialogues === dialogues &&
    cached.zones === zones &&
    cached.maps === maps
  ) {
    return cached.index
  }
  const index = buildIndex(dialogues, zones, maps)
  cached = { dialogues, zones, maps, index }
  return index
}

/**
 * The last index built and what it was built from.
 *
 * The canvas, the quest board and the insights screen all ask the same question of the same three
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
  maps: readonly GameMap[]
  index: ReadonlyMap<DialogueId, ZoneId[]>
} | null = null

function buildIndex(
  dialogues: readonly Dialogue[],
  zones: readonly Zone[],
  maps: readonly GameMap[],
): ReadonlyMap<DialogueId, ZoneId[]> {
  const { byMap } = zoneCandidates(zones, maps)
  const mapById = mapsById(maps)
  const index = new Map<DialogueId, ZoneId[]>()

  for (const dialogue of dialogues) {
    const map = mapById.get(dialogue.mapId)
    const hits: ZoneId[] = []
    // A dialogue whose `mapId` names no map cannot be placed on the canvas at all, the same
    // reason `trailVertices` drops one — it is outside every zone rather than in an unknown one.
    if (map !== undefined) {
      const canvasPoint = mapLocalToCanvas(map, dialogue.position)
      for (const candidate of byMap.get(map.id) ?? []) {
        const local = zoneLocalPoint(candidate, dialogue, canvasPoint)
        // The bounding box rejects the overwhelming majority for a quarter of the work of the
        // ray cast, which matters here: this is O(dialogues x zones) on every state change.
        if (!rectContains(candidate.bounds, local)) continue
        if (!pointInPolygon(local, candidate.zone.polygon)) continue
        hits.push(candidate.zone.id)
      }
    }
    index.set(dialogue.id, hits)
  }
  return index
}

/**
 * The pin in the candidate zone's own space.
 *
 * Verbatim for a zone on the pin's own map: converting up to canvas and back down is the identity
 * in exact arithmetic but not in floating point, and a pin sitting on a zone's edge must not
 * change sides because an unrelated map moved. Only a zone on *another* map is converted.
 */
function zoneLocalPoint(candidate: ZoneCandidate, dialogue: Dialogue, canvasPoint: Point): Point {
  if (candidate.map.id === dialogue.mapId) return dialogue.position
  return canvasToMapLocal(candidate.map, canvasPoint)
}

/**
 * The index again, with one zone's membership re-tested and nothing else touched.
 *
 * A zone drag rebuilds the index on every frame, and a full build is O(dialogues x zones) with
 * a ray cast per candidate. Only one polygon moved, so only one question changed: is this
 * dialogue inside *that* zone now. Every other zone's answer for that dialogue is the one the
 * previous index already holds.
 *
 * Every dialogue is re-tested, not only those on the moved zone's own map: a zone can hold pins
 * from any map laid over it, so "on another map" is no longer a reason to skip one. What still
 * bounds the work is the same overlap rule a full build applies — a pin on a map the moved zone
 * does not reach cannot be inside it.
 *
 * The result is identical to `indexDialoguesByZone(dialogues, zones, maps)` for the same input,
 * which `zone-index.test.ts` pins — an optimisation that may silently disagree with the definition
 * is worse than the cost it saves. It returns `previous` itself when no membership changed, so a
 * zone dragged through empty space costs the callers downstream nothing at all.
 *
 * Falls back to a full build when `previous` cannot be trusted to describe the same input: a
 * zone id that names nothing, a zone on a map that is gone, or a dialogue the previous index
 * never saw.
 */
export function reindexMovedZone(
  previous: ReadonlyMap<DialogueId, ZoneId[]>,
  dialogues: readonly Dialogue[],
  zones: readonly Zone[],
  maps: readonly GameMap[],
  movedId: ZoneId,
): ReadonlyMap<DialogueId, ZoneId[]> {
  const mapById = mapsById(maps)
  const moved = zones.find((zone) => zone.id === movedId)
  const movedMap = moved === undefined ? undefined : mapById.get(moved.mapId)
  if (moved === undefined || movedMap === undefined) {
    return indexDialoguesByZone(dialogues, zones, maps)
  }

  // A zone's position in the area-sorted candidate list *is* its rank, and that list is global, so
  // an id that has to go back into a dialogue's list lands where a full build would have put it —
  // the ordering rule stays in one place and this obeys the same one.
  const { rank } = zoneCandidates(zones, maps)
  const candidate: ZoneCandidate = { zone: moved, map: movedMap, bounds: polygonBounds(moved.polygon) }
  const reach = mapsReachedBy(zoneCanvasRect(movedMap, moved), maps)

  const next = new Map<DialogueId, ZoneId[]>()
  let changed = false

  for (const dialogue of dialogues) {
    const before = previous.get(dialogue.id)
    if (before === undefined) return indexDialoguesByZone(dialogues, zones, maps)

    const map = reach.has(dialogue.mapId) ? mapById.get(dialogue.mapId) : undefined
    const local =
      map === undefined
        ? null
        : zoneLocalPoint(candidate, dialogue, mapLocalToCanvas(map, dialogue.position))
    const inside =
      local !== null &&
      rectContains(candidate.bounds, local) &&
      pointInPolygon(local, moved.polygon)
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

/**
 * A zone placed on the canvas: the polygon, the map whose space it is written in, and its
 * map-local bounding box. The map travels with it because testing a pin from another map means
 * converting into *this* zone's space, which nothing but its own map can do.
 */
type ZoneCandidate = { zone: Zone; map: GameMap; bounds: Rect }

/**
 * The zones each map's pins have to be tested against, and every zone's rank in one global
 * area order.
 *
 * A bucket is geometric now rather than a `mapId` match: a zone belongs to the bucket of every
 * map whose canvas footprint it overlaps, which is the only way a pin on an interior map finds
 * the town zone underneath. Maps that lie apart on the canvas — which is where `nextMapOrigin`
 * puts every import — share no zones at all, so the common case still costs what it always did.
 */
type ZoneCandidates = {
  byMap: ReadonlyMap<MapId, ZoneCandidate[]>
  rank: ReadonlyMap<ZoneId, number>
}

function zoneCandidates(zones: readonly Zone[], maps: readonly GameMap[]): ZoneCandidates {
  if (
    cachedCandidates !== null &&
    cachedCandidates.zones === zones &&
    cachedCandidates.maps === maps
  ) {
    return cachedCandidates.candidates
  }
  const candidates = buildCandidates(zones, maps)
  cachedCandidates = { zones, maps, candidates }
  return candidates
}

/**
 * The buckets, kept for as long as the zones and the maps are the same arrays. Sorting is the
 * expensive half of a build for an unchanged zone set, and a zone drag asks for the same set
 * once per frame.
 */
let cachedCandidates: {
  zones: readonly Zone[]
  maps: readonly GameMap[]
  candidates: ZoneCandidates
} | null = null

function buildCandidates(zones: readonly Zone[], maps: readonly GameMap[]): ZoneCandidates {
  const mapById = mapsById(maps)

  // A zone whose `mapId` names no map has no placement on the canvas, so there is no space to
  // test a point in — it was unreachable under the old map-local rule too.
  const placed: { candidate: ZoneCandidate; canvasRect: Rect; canvasArea: number }[] = []
  for (const zone of zones) {
    const map = mapById.get(zone.mapId)
    if (map === undefined) continue
    placed.push({
      candidate: { zone, map, bounds: polygonBounds(zone.polygon) },
      canvasRect: zoneCanvasRect(map, zone),
      // Canvas area, not map-local: a zone drawn on a map at `scale: 2` covers four times the
      // canvas its vertices suggest, and "smallest zone wins" compares what is on the canvas.
      canvasArea: polygonArea(zone.polygon) * map.scale * map.scale,
    })
  }
  // Sorting here rather than per dialogue is what makes the hit list come out ordered for free —
  // the area of a polygon is the same whichever dialogue is being tested against it.
  placed.sort((a, b) => a.canvasArea - b.canvasArea)

  const byMap = new Map<MapId, ZoneCandidate[]>()
  const rank = new Map<ZoneId, number>()
  placed.forEach((entry, index) => {
    rank.set(entry.candidate.zone.id, index)
    for (const mapId of mapsReachedBy(entry.canvasRect, maps)) {
      const bucket = byMap.get(mapId)
      if (bucket === undefined) byMap.set(mapId, [entry.candidate])
      else bucket.push(entry.candidate)
    }
  })
  return { byMap, rank }
}

/**
 * The maps whose pins a zone of this canvas footprint could contain. One rule, called from both
 * the build and the incremental re-test, so the two can never disagree about which dialogues a
 * moved zone was allowed to claim.
 */
function mapsReachedBy(zoneRect: Rect, maps: readonly GameMap[]): ReadonlySet<MapId> {
  const reached = new Set<MapId>()
  for (const map of maps) {
    if (rectsOverlap(zoneRect, mapCanvasRect(map))) reached.add(map.id)
  }
  return reached
}

function mapsById(maps: readonly GameMap[]): ReadonlyMap<MapId, GameMap> {
  return new Map<MapId, GameMap>(maps.map((map) => [map.id, map]))
}

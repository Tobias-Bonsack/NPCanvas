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
 * Which zones each dialogue falls inside, derived from the geometry on every read (never stored
 * — see CLAUDE.md). A list, ordered by ascending canvas area, since zones may overlap and
 * "smallest wins" must mean the same thing across maps of different `scale`. Decided in canvas
 * space, not map-local, so a map lying over another map's zone still counts (`zoneAtCanvasPoint`
 * is the click-time exception: it consults only the topmost map, since a click means what is
 * visible). Every dialogue gets an entry, including an empty one, so "outside any zone" is
 * distinguishable from "never indexed".
 *
 * Cached at module scope on the identity of (dialogues, zones, maps), never on value.
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

// One slot, not a keyed cache: the question is always "the document as it is now". Keyed on
// identity, never value — the reducer returns the same reference for a no-op edit.
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
    if (map !== undefined) {
      const canvasPoint = mapLocalToCanvas(map, dialogue.position)
      for (const candidate of byMap.get(map.id) ?? []) {
        const local = zoneLocalPoint(candidate, dialogue, canvasPoint)
        // Bounding-box reject first — cheap, and this runs O(dialogues x zones) on every change.
        if (!rectContains(candidate.bounds, local)) continue
        if (!pointInPolygon(local, candidate.zone.polygon)) continue
        hits.push(candidate.zone.id)
      }
    }
    index.set(dialogue.id, hits)
  }
  return index
}

// Verbatim for a zone on the pin's own map — round-tripping through canvas space is not exact
// in floating point, and a pin on a zone's edge must not change sides because another map moved.
function zoneLocalPoint(candidate: ZoneCandidate, dialogue: Dialogue, canvasPoint: Point): Point {
  if (candidate.map.id === dialogue.mapId) return dialogue.position
  return canvasToMapLocal(candidate.map, canvasPoint)
}

/**
 * The index again, with only `movedId`'s membership re-tested — keeps a zone drag at O(dialogues)
 * per frame instead of a full O(dialogues x zones) rebuild. Every other zone's answer for a
 * dialogue is carried over from `previous` unchanged. Returns `previous` itself when nothing
 * changed. Falls back to a full build when `previous` cannot be trusted to describe the same
 * input (an unknown zone id, a zone whose map is gone, or a dialogue `previous` never saw) — the
 * result must always equal `indexDialoguesByZone` on the same input, which the tests pin.
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

// Derived from the index, not the geometry a second time, so counts and labels can't disagree.
// A dialogue in two overlapping zones counts for both.
export function countDialoguesByZone(
  index: ReadonlyMap<DialogueId, ZoneId[]>,
): ReadonlyMap<ZoneId, number> {
  const counts = new Map<ZoneId, number>()
  for (const zoneIds of index.values()) {
    for (const zoneId of zoneIds) counts.set(zoneId, (counts.get(zoneId) ?? 0) + 1)
  }
  return counts
}

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

type ZoneCandidate = { zone: Zone; map: GameMap; bounds: Rect }

// Buckets are geometric, not a mapId match: a zone belongs to the bucket of every map whose
// canvas footprint overlaps it, so a pin on an interior map can find the town zone underneath.
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

let cachedCandidates: {
  zones: readonly Zone[]
  maps: readonly GameMap[]
  candidates: ZoneCandidates
} | null = null

function buildCandidates(zones: readonly Zone[], maps: readonly GameMap[]): ZoneCandidates {
  const mapById = mapsById(maps)

  const placed: { candidate: ZoneCandidate; canvasRect: Rect; canvasArea: number }[] = []
  for (const zone of zones) {
    const map = mapById.get(zone.mapId)
    if (map === undefined) continue
    placed.push({
      candidate: { zone, map, bounds: polygonBounds(zone.polygon) },
      canvasRect: zoneCanvasRect(map, zone),
      canvasArea: polygonArea(zone.polygon) * map.scale * map.scale, // scale² so "smallest wins" compares canvas area
    })
  }
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

// One rule, used by both the full build and the incremental re-test, so they can't disagree.
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

import { byTimeAsc } from '../dialogue/dialogue-order.ts'
import type { Dialogue, DialogueId, GameMap, MapId, Point } from '../project/types.ts'
import { mapLocalToCanvas } from './canvas-layout.ts'

/**
 * One vertex of the trail: where a line was heard, on the shared canvas, and which dialogue it
 * belongs to.
 *
 * The id travels with the point because a caller has to be able to address a single vertex
 * without a second lookup into the document — substituting a dragged pin's live position is a
 * match on this id and nothing else.
 */
export type TrailVertex = { id: DialogueId; point: Point }

/**
 * The trail through `dialogues`, earliest first, in **canvas** space.
 *
 * Canvas rather than map-local is the one place this feature departs from `ZoneLayer` and
 * `PinLayer`, which both write stored map-local coordinates into the markup verbatim under a
 * per-map group. Time crosses maps: two consecutive lines can sit on two different images, and
 * the segment between them exists in neither one's map-local space, so no per-map group could
 * hold it. `mapLocalToCanvas` is therefore the only conversion here, and the only one anywhere
 * in the trail.
 *
 * Two kinds of dialogue are dropped rather than guessed at. One whose `spokenAt` does not parse
 * has no place in a time order at all; one whose `mapId` names no map has no place on the canvas,
 * the same reason `PinLayer`'s bucket for a missing map is simply never read.
 */
export function trailVertices(
  maps: readonly GameMap[],
  dialogues: readonly Dialogue[],
): readonly TrailVertex[] {
  const byId = new Map<MapId, GameMap>(maps.map((map) => [map.id, map]))

  // The map is carried alongside rather than looked up again after the sort, so the conversion
  // below needs no non-null assertion for something this loop has already proved.
  const timed: { dialogue: Dialogue; map: GameMap }[] = []
  for (const dialogue of dialogues) {
    const map = byId.get(dialogue.mapId)
    if (map === undefined) continue
    if (Number.isNaN(Date.parse(dialogue.spokenAt))) continue
    timed.push({ dialogue, map })
  }

  // Through the shared comparator, not the shared cached order: a drag substitutes the moved
  // pin's live position into `vertices` after this sort, so a `pointermove` must never re-sort
  // the document (see CLAUDE.md § "World-space layers must stay viewport-independent").
  //
  // `Array.prototype.sort` is stable, so lines sharing one instant keep the order the document
  // gives them. That is what makes the trail through a burst of captures deterministic without
  // decorating every entry with its index.
  timed.sort((a, b) => byTimeAsc(a.dialogue, b.dialogue))

  return timed.map(({ dialogue, map }) => ({
    id: dialogue.id,
    point: mapLocalToCanvas(map, dialogue.position),
  }))
}

/**
 * Where a direction marker goes on each segment, and which way it points: the midpoint in canvas
 * space, and the bearing in **degrees** — what an SVG `rotate()` consumes, with 0 pointing along
 * +x, so a glyph drawn facing right needs no correction.
 *
 * The midpoint rather than either end, because a mark drawn *at* a pin competes with the pin, and
 * because a mark between two of them reads as belonging to the segment rather than to one vertex.
 */
export type TrailArrow = { point: Point; angle: number }

/**
 * Below this, in canvas units, a segment has no direction worth drawing. Two lines logged at one
 * point are the case: `Math.atan2(0, 0)` is `0`, which would silently plant an arrow pointing
 * right and meaning nothing. Absorbed rather than prevented, the way `polygonCentroid` absorbs a
 * zero-area polygon.
 */
const MIN_SEGMENT = 1e-3

/** One arrow per drawn segment, in the order `vertices` gives — so earliest-first, like it. */
export function trailArrows(vertices: readonly TrailVertex[]): readonly TrailArrow[] {
  const arrows: TrailArrow[] = []
  for (let index = 1; index < vertices.length; index++) {
    const from = vertices[index - 1].point
    const to = vertices[index].point
    const dx = to.x - from.x
    const dy = to.y - from.y
    if (Math.hypot(dx, dy) < MIN_SEGMENT) continue
    arrows.push({
      point: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    })
  }
  return arrows
}

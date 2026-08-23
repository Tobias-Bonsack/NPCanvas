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

  // `Date.parse` rather than comparing the ISO strings directly the way `QuestBoard` does: the
  // same call is the validity guard the sort needs, and it is also correct for a hand-edited
  // `data.json` carrying an offset — "…+02:00" sorts before "…Z" as text and after it in time.
  //
  // The map is carried alongside rather than looked up again after the sort, so the conversion
  // below needs no non-null assertion for something this loop has already proved.
  const timed: { dialogue: Dialogue; map: GameMap; at: number }[] = []
  for (const dialogue of dialogues) {
    const map = byId.get(dialogue.mapId)
    if (map === undefined) continue
    const at = Date.parse(dialogue.spokenAt)
    if (Number.isNaN(at)) continue
    timed.push({ dialogue, map, at })
  }

  // `Array.prototype.sort` is stable, so lines sharing one instant keep the order the document
  // gives them. That is what makes the trail through a burst of captures deterministic without
  // decorating every entry with its index.
  timed.sort((a, b) => a.at - b.at)

  return timed.map(({ dialogue, map }) => ({
    id: dialogue.id,
    point: mapLocalToCanvas(map, dialogue.position),
  }))
}

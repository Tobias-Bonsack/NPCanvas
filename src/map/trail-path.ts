import { byTimeAsc } from '../dialogue/dialogue-order.ts'
import type { Dialogue, DialogueId, GameMap, MapId, Point } from '../project/types.ts'
import { mapLocalToCanvas } from './canvas-layout.ts'

// id travels with the point so a drag can substitute the moved pin's live position by matching it.
export type TrailVertex = { id: DialogueId; point: Point }

// Canvas space, not map-local like ZoneLayer/PinLayer — time crosses maps, so a segment between
// two dialogues on different images has no single map-local space to live in. Dialogues with an
// unparseable spokenAt or an unknown mapId are dropped rather than guessed at.
export function trailVertices(
  maps: readonly GameMap[],
  dialogues: readonly Dialogue[],
): readonly TrailVertex[] {
  const byId = new Map<MapId, GameMap>(maps.map((map) => [map.id, map]))

  const timed: { dialogue: Dialogue; map: GameMap }[] = []
  for (const dialogue of dialogues) {
    const map = byId.get(dialogue.mapId)
    if (map === undefined) continue
    if (Number.isNaN(Date.parse(dialogue.spokenAt))) continue
    timed.push({ dialogue, map })
  }

  // Stable sort: lines sharing one instant keep document order, making a capture burst deterministic.
  timed.sort((a, b) => byTimeAsc(a.dialogue, b.dialogue))

  return timed.map(({ dialogue, map }) => ({
    id: dialogue.id,
    point: mapLocalToCanvas(map, dialogue.position),
  }))
}

// Midpoint (not either end) in canvas space; angle in degrees for SVG rotate(), 0 along +x.
export type TrailArrow = { point: Point; angle: number }

// Below this, atan2(0,0) would plant a meaningless arrow for two lines logged at one point.
const MIN_SEGMENT = 1e-3

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

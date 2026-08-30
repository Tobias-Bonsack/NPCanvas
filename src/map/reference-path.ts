import type { Dialogue, DialogueId, GameMap, MapId, Point } from '../project/types.ts'
import { mapLocalToCanvas } from './canvas-layout.ts'

// Canvas space, not map-local — an edge can join two lines on two different map images, the
// same reason the trail is drawn in canvas space (see trail-path.ts). An endpoint whose mapId
// is unknown, or whose target dialogue is gone, is dropped rather than guessed at — the same
// rule trailVertices applies to a dangling dialogue.
type ReferenceEdge = {
  from: DialogueId
  to: DialogueId
  fromPoint: Point
  toPoint: Point
}

// One edge per stored reference — a dialogue pointing at three lines draws three edges, not one
// fan-out shape.
export function referenceEdges(
  maps: readonly GameMap[],
  dialogues: readonly Dialogue[],
): readonly ReferenceEdge[] {
  const mapsById = new Map<MapId, GameMap>(maps.map((map) => [map.id, map]))
  const dialoguesById = new Map<DialogueId, Dialogue>(dialogues.map((dialogue) => [dialogue.id, dialogue]))

  const edges: ReferenceEdge[] = []
  for (const dialogue of dialogues) {
    const fromMap = mapsById.get(dialogue.mapId)
    if (fromMap === undefined) continue
    for (const targetId of dialogue.references) {
      const target = dialoguesById.get(targetId)
      if (target === undefined) continue
      const toMap = mapsById.get(target.mapId)
      if (toMap === undefined) continue
      edges.push({
        from: dialogue.id,
        to: target.id,
        fromPoint: mapLocalToCanvas(fromMap, dialogue.position),
        toPoint: mapLocalToCanvas(toMap, target.position),
      })
    }
  }
  return edges
}

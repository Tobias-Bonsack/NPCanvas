import type { ReactElement } from 'react'
import { memo, useMemo } from 'react'
import type { Dialogue, DialogueId, GameMap } from '../project/types.ts'
import { CanvasLineLayer } from './CanvasLineLayer.tsx'
import type { PinDragPreview } from './PinLayer.tsx'
import { mapLocalToCanvas, mapsBounds } from './canvas-layout.ts'
import type { TrailVertex } from './trail-path.ts'
import { trailArrows, trailVertices } from './trail-path.ts'

// The only layer drawn in canvas space rather than per-map groups — time crosses maps, so a
// segment can join two lines on two different images (see trail-path.ts). Deliberately not
// culled against the visible rect, like ReferenceLayer: a segment with both endpoints off-screen
// can still cross the viewport. Taking no viewport-derived prop is what keeps the memo below
// trivially correct.
export const TrailLayer = memo(function TrailLayer({
  maps,
  dialogues,
  highlighted,
  pinDrag,
}: {
  maps: readonly GameMap[]
  dialogues: readonly Dialogue[]
  highlighted: ReadonlySet<DialogueId> | null
  // The pin under the pointer mid-drag — without it the line would snap on drop instead of
  // following live, since dialogue/moved is dispatched once, on pointerup.
  pinDrag: PinDragPreview | null
}): ReactElement | null {
  const threaded = useMemo(
    () =>
      highlighted === null
        ? dialogues
        : dialogues.filter((dialogue) => highlighted.has(dialogue.id)),
    [dialogues, highlighted],
  )
  const vertices = useMemo(() => trailVertices(maps, threaded), [maps, threaded])

  // Substituted after the ordering, never before — a preview-patched dialogue array into
  // trailVertices would re-sort the whole project on every pointermove.
  const drawn = useMemo(() => {
    if (pinDrag === null) return vertices
    if (!vertices.some((vertex) => vertex.id === pinDrag.id)) return vertices
    const dialogue = dialogues.find((candidate) => candidate.id === pinDrag.id)
    if (dialogue === undefined) return vertices
    const map = maps.find((candidate) => candidate.id === dialogue.mapId)
    if (map === undefined) return vertices
    const point = mapLocalToCanvas(map, pinDrag.position)
    return vertices.map((vertex) => (vertex.id === pinDrag.id ? { id: vertex.id, point } : vertex))
  }, [vertices, dialogues, maps, pinDrag])

  const arrows = useMemo(() => trailArrows(drawn), [drawn])
  const bounds = useMemo(() => mapsBounds(maps), [maps])

  if (drawn.length < 2 || bounds === null) return null

  const points = pointsAttribute(drawn)

  return (
    <CanvasLineLayer
      classPrefix="trail-layer"
      bounds={bounds}
      halo={<polyline className="trail-layer__halo" points={points} />}
      path={<polyline className="trail-layer__path" points={points} />}
      arrows={arrows}
    />
  )
})

function pointsAttribute(vertices: readonly TrailVertex[]): string {
  return vertices.map((vertex) => `${vertex.point.x},${vertex.point.y}`).join(' ')
}

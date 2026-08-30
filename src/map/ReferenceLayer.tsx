import type { ReactElement } from 'react'
import { memo, useMemo } from 'react'
import type { Dialogue, DialogueId, GameMap } from '../project/types.ts'
import { CanvasLineLayer } from './CanvasLineLayer.tsx'
import type { PinDragPreview } from './PinLayer.tsx'
import { mapLocalToCanvas, mapsBounds } from './canvas-layout.ts'
import { referenceEdges } from './reference-path.ts'
import { segmentArrow } from './trail-path.ts'

// Drawn in canvas space, like the trail, for the same reason: an edge can join two lines on two
// different map images. Deliberately not culled against the visible rect — a segment with both
// endpoints off screen can still cross the viewport. Taking no viewport-derived prop is what
// keeps the memo below trivially correct.
export const ReferenceLayer = memo(function ReferenceLayer({
  maps,
  dialogues,
  highlighted,
  pinDrag,
}: {
  maps: readonly GameMap[]
  dialogues: readonly Dialogue[]
  highlighted: ReadonlySet<DialogueId> | null
  // The pin under the pointer mid-drag — without it an edge would snap on drop instead of
  // following live, since dialogue/moved is dispatched once, on pointerup.
  pinDrag: PinDragPreview | null
}): ReactElement | null {
  const edges = useMemo(() => referenceEdges(maps, dialogues), [maps, dialogues])

  // Substituted after the edges are built, never before — a preview-patched dialogue array into
  // referenceEdges would rebuild every edge on every pointermove.
  const drawn = useMemo(() => {
    if (pinDrag === null) return edges
    if (!edges.some((edge) => edge.from === pinDrag.id || edge.to === pinDrag.id)) return edges
    const dialogue = dialogues.find((candidate) => candidate.id === pinDrag.id)
    if (dialogue === undefined) return edges
    const map = maps.find((candidate) => candidate.id === dialogue.mapId)
    if (map === undefined) return edges
    const point = mapLocalToCanvas(map, pinDrag.position)
    return edges.map((edge) => {
      if (edge.from === pinDrag.id) return { ...edge, fromPoint: point }
      if (edge.to === pinDrag.id) return { ...edge, toPoint: point }
      return edge
    })
  }, [edges, dialogues, maps, pinDrag])

  // An edge is drawn only when both endpoints survive the quest filter — the same semantics
  // the trail has.
  const shown = useMemo(
    () =>
      highlighted === null
        ? drawn
        : drawn.filter((edge) => highlighted.has(edge.from) && highlighted.has(edge.to)),
    [drawn, highlighted],
  )

  const bounds = useMemo(() => mapsBounds(maps), [maps])

  if (shown.length === 0 || bounds === null) return null

  const arrows = shown.flatMap((edge) => {
    const arrow = segmentArrow(edge.fromPoint, edge.toPoint)
    return arrow === null ? [] : [arrow]
  })

  return (
    <CanvasLineLayer
      classPrefix="reference-layer"
      bounds={bounds}
      halo={shown.map((edge) => (
        <line
          key={`${edge.from}-${edge.to}-halo`}
          className="reference-layer__halo"
          x1={edge.fromPoint.x}
          y1={edge.fromPoint.y}
          x2={edge.toPoint.x}
          y2={edge.toPoint.y}
        />
      ))}
      path={shown.map((edge) => (
        <line
          key={`${edge.from}-${edge.to}-path`}
          className="reference-layer__path"
          x1={edge.fromPoint.x}
          y1={edge.fromPoint.y}
          x2={edge.toPoint.x}
          y2={edge.toPoint.y}
        />
      ))}
      arrows={arrows}
    />
  )
})

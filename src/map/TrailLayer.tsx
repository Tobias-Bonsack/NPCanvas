import type { CSSProperties, ReactElement } from 'react'
import { memo, useMemo } from 'react'
import type { Dialogue, DialogueId, GameMap } from '../project/types.ts'
import type { PinDragPreview } from './PinLayer.tsx'
import { mapLocalToCanvas, mapsBounds } from './canvas-layout.ts'
import type { TrailArrow, TrailVertex } from './trail-path.ts'
import { trailArrows, trailVertices } from './trail-path.ts'

// The only layer drawn in canvas space rather than per-map groups — time crosses maps, so a
// segment can join two lines on two different images (see trail-path.ts). Deliberately not
// culled against the visible rect, unlike PinLayer/ZoneLayer: a segment with both endpoints
// off-screen can still cross the viewport. Taking no viewport-derived prop is what keeps the
// memo below trivially correct.
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
    <div className="trail-layer">
      <svg
        className="trail-layer__svg"
        style={{ left: `${bounds.x}px`, top: `${bounds.y}px` }}
        width={bounds.width}
        height={bounds.height}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        aria-hidden="true"
      >
        {/* Two passes: a wider dark halo stroke underneath, the coloured line on top — a stroke
            has no fill, so this is what an outlined stroke is. No vector-effect: see MapCanvas.css
            for the measured non-scaling-stroke finding this app can't rely on. */}
        <polyline className="trail-layer__halo" points={points} />
        <polyline className="trail-layer__path" points={points} />
        {arrows.map((arrow, index) => (
          <Arrowhead key={index} arrow={arrow} />
        ))}
      </svg>
    </div>
  )
})

// translate/rotate come from the geometry; the counter-scale keeping the head a constant screen
// size is in CSS against --map-zoom, since vector-effect leaves a stroke unscaled but not a shape.
function Arrowhead({ arrow }: { arrow: TrailArrow }): ReactElement {
  return <path className="trail-layer__arrow" style={arrowStyle(arrow)} d={ARROW_HEAD} />
}

// A triangle about the origin pointing along +x, in canvas units before the counter-scale.
const ARROW_HEAD = 'M -6 -6 L 9 0 L -6 6 Z'

function arrowStyle(arrow: TrailArrow): CSSProperties & Record<'--arrow-place', string> {
  return {
    '--arrow-place': `translate(${arrow.point.x}px, ${arrow.point.y}px) rotate(${arrow.angle}deg)`,
  }
}

function pointsAttribute(vertices: readonly TrailVertex[]): string {
  return vertices.map((vertex) => `${vertex.point.x},${vertex.point.y}`).join(' ')
}

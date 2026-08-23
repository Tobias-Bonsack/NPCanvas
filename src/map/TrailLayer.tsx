import type { CSSProperties, ReactElement } from 'react'
import { memo, useMemo } from 'react'
import type { Dialogue, DialogueId, GameMap } from '../project/types.ts'
import type { PinDragPreview } from './PinLayer.tsx'
import { mapLocalToCanvas, mapsBounds } from './canvas-layout.ts'
import type { TrailArrow, TrailVertex } from './trail-path.ts'
import { trailArrows, trailVertices } from './trail-path.ts'

/**
 * The line time draws: one polyline threading every pin from the earliest line heard to the
 * latest, beneath the pins and above the zones.
 *
 * The only layer that draws in **canvas** space rather than per-map groups. Time crosses maps, so
 * a segment can join two lines heard on two different images and belongs to neither one's
 * coordinates — see `trail-path.ts`. The `<svg>` is laid on `mapsBounds` and given a `viewBox`
 * carrying the same offset, which keeps this file as free of coordinate maths as `ZoneLayer`: the
 * canvas coordinates go into `points` verbatim.
 *
 * Deliberately **not** culled against the visible rect, unlike `PinLayer` and `ZoneLayer`. A
 * segment whose two endpoints are both off screen can still cross the viewport, so dropping it
 * would tear the line. Not taking `visibleRect` at all is also what makes the `memo` above
 * trivially correct: every prop here is document- or selection-derived, never viewport-derived.
 */
export const TrailLayer = memo(function TrailLayer({
  maps,
  dialogues,
  highlighted,
  pinDrag,
}: {
  /** Already carrying any in-progress map drag preview — see `MapScreen`. */
  maps: readonly GameMap[]
  dialogues: readonly Dialogue[]
  /**
   * The dialogues every active canvas filter agrees on, exactly as `PinLayer` receives them, so
   * the trail threads what the canvas is showing rather than crossing pins it has just dimmed.
   * `null` means no filter is active — which must not be read as a filter that matched nothing.
   */
  highlighted: ReadonlySet<DialogueId> | null
  /**
   * The pin currently under the pointer, in its map's map-local space, or `null` when none is —
   * see `PinLayer`'s `onPinDrag`. Without it the line would stay on the position `data.json`
   * still holds and snap when the drag lands, because `dialogue/moved` is dispatched once, on
   * pointerup.
   */
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

  // Substituted *after* the ordering, never before it. Handing `trailVertices` a preview-patched
  // dialogue array instead would re-sort every dialogue in the project on every `pointermove`, to
  // move one point — so the sort above stays keyed on the document and this runs per frame.
  //
  // Returns `vertices` by reference whenever nothing matches, which is what keeps the arrows below
  // from recomputing for a drag the trail does not draw: a pin filtered out by `highlighted`, or
  // one whose line has no parsable time, is simply not in this chain.
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

  // One vertex is not a line, and a canvas with no maps has no rectangle to lay the svg on.
  if (drawn.length < 2 || bounds === null) return null

  return (
    <div className="trail-layer">
      {/* Decorative: the order it draws is already readable from each dialogue's own date in the
          panel and in Insights, and a polyline has no accessible name worth giving. */}
      <svg
        className="trail-layer__svg"
        style={{ left: `${bounds.x}px`, top: `${bounds.y}px` }}
        width={bounds.width}
        height={bounds.height}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        aria-hidden="true"
      >
        {/* `vector-effect` is what keeps the line a constant width on screen at any zoom without
            a single line of JS — the stroke is simply not scaled by the ancestor transforms. */}
        <polyline
          className="trail-layer__path"
          points={pointsAttribute(drawn)}
          vectorEffect="non-scaling-stroke"
        />
        {/* A bare polyline is symmetric: it shows the pins are in a sequence and nothing about
            which end of it is the earliest, which is the one claim this feature makes. */}
        {arrows.map((arrow, index) => (
          // Keyed by position: an arrow belongs to a segment, and a segment has no identity of
          // its own beyond where it sits in the chain.
          <Arrowhead key={index} arrow={arrow} />
        ))}
      </svg>
    </div>
  )
})

/**
 * One direction marker, sitting on its segment's midpoint and pointing the way time runs.
 *
 * `translate` and `rotate` come from the geometry; the counter-scale that keeps the head a
 * constant size on screen is in CSS, against the `--map-zoom` the world element publishes — the
 * same division `.zone-layer__label` needs, because `vector-effect` leaves a *stroke* unscaled but
 * not a *shape*. The two must be composed in one declaration, so the transform lands here as a
 * custom property the stylesheet interpolates rather than as a `transform` of its own.
 *
 * Filled rather than stroked, for the reason `QuestFlag` and `ContentGlyph` are: at this size a
 * stroke lands near a single physical pixel and reads as a smudge.
 */
function Arrowhead({ arrow }: { arrow: TrailArrow }): ReactElement {
  return <path className="trail-layer__arrow" style={arrowStyle(arrow)} d={ARROW_HEAD} />
}

/**
 * A triangle drawn about the origin and pointing along +x, which is what makes `trailArrows`'
 * bearing usable with no correction. In canvas units before the counter-scale, so these numbers
 * are also its size in screen pixels once it is applied.
 */
const ARROW_HEAD = 'M -3.5 -3.5 L 4.5 0 L -3.5 3.5 Z'

/**
 * The intersection type is how the custom property reaches `style` without an `as` cast —
 * `mapGroupStyle` does the same for `--map-scale`.
 */
function arrowStyle(arrow: TrailArrow): CSSProperties & Record<'--arrow-place', string> {
  return {
    '--arrow-place': `translate(${arrow.point.x}px, ${arrow.point.y}px) rotate(${arrow.angle}deg)`,
  }
}

/** SVG's own vertex list format: "x,y x,y …" — the same shape `ZoneLayer` writes for a polygon. */
function pointsAttribute(vertices: readonly TrailVertex[]): string {
  return vertices.map((vertex) => `${vertex.point.x},${vertex.point.y}`).join(' ')
}

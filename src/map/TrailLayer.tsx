import type { ReactElement } from 'react'
import { memo, useMemo } from 'react'
import type { Dialogue, DialogueId, GameMap } from '../project/types.ts'
import { mapsBounds } from './canvas-layout.ts'
import type { TrailVertex } from './trail-path.ts'
import { trailVertices } from './trail-path.ts'

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
}): ReactElement | null {
  const threaded = useMemo(
    () =>
      highlighted === null
        ? dialogues
        : dialogues.filter((dialogue) => highlighted.has(dialogue.id)),
    [dialogues, highlighted],
  )
  const vertices = useMemo(() => trailVertices(maps, threaded), [maps, threaded])
  const bounds = useMemo(() => mapsBounds(maps), [maps])

  // One vertex is not a line, and a canvas with no maps has no rectangle to lay the svg on.
  if (vertices.length < 2 || bounds === null) return null

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
          points={pointsAttribute(vertices)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
})

/** SVG's own vertex list format: "x,y x,y …" — the same shape `ZoneLayer` writes for a polygon. */
function pointsAttribute(vertices: readonly TrailVertex[]): string {
  return vertices.map((vertex) => `${vertex.point.x},${vertex.point.y}`).join(' ')
}

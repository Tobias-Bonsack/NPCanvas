import { assertNever } from '../assert-never.ts'
import type { Point, Polygon } from '../project/types.ts'
import { polygonBounds } from './geometry.ts'

/**
 * Resizing a zone is a scale of its polygon about a fixed anchor, never an edit of one
 * vertex: a zone is a region, and "make it bigger" means the shape a user drew keeps its
 * proportions. A four-point rectangle therefore stays a rectangle, and a hand-drawn outline
 * stretches rather than acquiring a dent.
 *
 * Everything here is map-local — the space `Zone.polygon` is stored in — so a caller
 * converts the pointer once and nothing in this file knows about the canvas or the screen.
 */

/**
 * The eight grips of the bounding box, named by compass point. Corners scale both axes, edge
 * midpoints scale one. The order is the order they are drawn in, clockwise from the top left,
 * which is also the order the hit test walks.
 */
export type ZoneHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/**
 * A bounding box axis is degenerate below this, in map-local pixels. Scaling it would divide
 * by zero, so the axis is left alone instead — see `axisScale`. A zone drawn through the
 * canvas cannot get here (`MIN_ZONE_SIZE` rejects it), but a polygon whose vertices happen to
 * be collinear can, and it must resize on its other axis rather than turn into `NaN`.
 */
const DEGENERATE = 1e-6

type ZoneHandlePoint = { handle: ZoneHandle; point: Point }

/** Where each grip sits, for drawing them and for hit-testing them alike. */
export function zoneHandlePoints(polygon: Polygon): ZoneHandlePoint[] {
  const { x, y, width, height } = polygonBounds(polygon)
  const midX = x + width / 2
  const midY = y + height / 2
  const right = x + width
  const bottom = y + height
  return [
    { handle: 'nw', point: { x, y } },
    { handle: 'n', point: { x: midX, y } },
    { handle: 'ne', point: { x: right, y } },
    { handle: 'e', point: { x: right, y: midY } },
    { handle: 'se', point: { x: right, y: bottom } },
    { handle: 's', point: { x: midX, y: bottom } },
    { handle: 'sw', point: { x, y: bottom } },
    { handle: 'w', point: { x, y: midY } },
  ]
}

/**
 * The grip a press lands on, nearest first, or `null` when the press is further than
 * `tolerance` from every one of them. Nearest rather than first-within-tolerance because the
 * grips of a small zone overlap: on a box a few pixels across every corner is within reach of
 * every other, and picking the closest is the only answer that matches what was aimed at.
 *
 * `tolerance` is map-local, so a caller converts one screen radius through the live scale —
 * which is what keeps the grab area a constant size on screen at every zoom.
 */
export function handleAtMapLocalPoint(
  polygon: Polygon,
  point: Point,
  tolerance: number,
): ZoneHandle | null {
  let best: ZoneHandle | null = null
  let bestDistance = tolerance
  for (const candidate of zoneHandlePoints(polygon)) {
    const distance = Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y)
    if (distance > bestDistance) continue
    best = candidate.handle
    bestDistance = distance
  }
  return best
}

/**
 * The polygon with `handle` dragged by `delta`, every vertex scaled about the opposite edge
 * or corner — so the side being dragged moves and the side across from it stays where the
 * user left it.
 *
 * `minSize` is the floor for each axis of the bounding box, in map-local pixels. Clamping
 * rather than allowing a flip: dragging the east grip past the west one would otherwise turn
 * the zone inside out, which reads as the shape teleporting rather than as a size the user
 * chose. The floor is a caller's decision because it is really a screen-size question — see
 * `MIN_ZONE_SIZE`.
 */
export function resizePolygon(
  polygon: Polygon,
  handle: ZoneHandle,
  delta: Point,
  minSize: number,
): Polygon {
  const bounds = polygonBounds(polygon)
  const floor = Math.max(minSize, DEGENERATE)
  const x = axisScale(bounds.x, bounds.width, horizontalEdge(handle), delta.x, floor)
  const y = axisScale(bounds.y, bounds.height, verticalEdge(handle), delta.y, floor)

  const scale = (point: Point): Point => ({
    x: x.anchor + (point.x - x.anchor) * x.factor,
    y: y.anchor + (point.y - y.anchor) * y.factor,
  })
  // Destructured rather than `.map()`ed, for the reason `translatePolygon` gives: `map`
  // widens the three-vertex guarantee back to `Point[]`.
  const [a, b, c, ...rest] = polygon
  return [scale(a), scale(b), scale(c), ...rest.map(scale)]
}

/** Which end of an axis a grip moves, `'none'` being an axis it does not touch at all. */
type Edge = 'start' | 'end' | 'none'

/**
 * The fixed point of one axis and the factor every coordinate on it is scaled by. A
 * degenerate axis yields the identity: there is no size to scale, and dividing by it would
 * make the whole polygon `NaN`.
 */
function axisScale(
  start: number,
  size: number,
  edge: Edge,
  delta: number,
  minSize: number,
): { anchor: number; factor: number } {
  if (edge === 'none' || size < DEGENERATE) return { anchor: start, factor: 1 }
  if (edge === 'end') {
    return { anchor: start, factor: Math.max(minSize, size + delta) / size }
  }
  return { anchor: start + size, factor: Math.max(minSize, size - delta) / size }
}

function horizontalEdge(handle: ZoneHandle): Edge {
  switch (handle) {
    case 'nw':
    case 'w':
    case 'sw':
      return 'start'
    case 'ne':
    case 'e':
    case 'se':
      return 'end'
    case 'n':
    case 's':
      return 'none'
    default:
      return assertNever(handle)
  }
}

function verticalEdge(handle: ZoneHandle): Edge {
  switch (handle) {
    case 'nw':
    case 'n':
    case 'ne':
      return 'start'
    case 'sw':
    case 's':
    case 'se':
      return 'end'
    case 'e':
    case 'w':
      return 'none'
    default:
      return assertNever(handle)
  }
}

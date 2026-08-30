import { assertNever } from '../assert-never.ts'
import type { Point, Polygon } from '../project/types.ts'
import { polygonBounds } from './geometry.ts'

// Resizing scales every vertex about a fixed anchor, never edits one vertex — a rectangle
// stays a rectangle, a hand-drawn outline stretches rather than acquiring a dent. Everything
// here is map-local; a caller converts the pointer once.

export type ZoneHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

// Below this, in map-local pixels, a bounding-box axis is degenerate and left unscaled rather
// than divided by zero — a collinear-vertex polygon can reach this even though MIN_ZONE_SIZE
// rejects a drawn zone that small.
const DEGENERATE = 1e-6

type ZoneHandlePoint = { handle: ZoneHandle; point: Point }

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

// Nearest grip within `tolerance`, not first-within-tolerance — a small zone's grips overlap.
// `tolerance` is map-local; a caller converts a screen radius through the live scale.
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

// minSize clamps rather than allows a flip — dragging the east grip past the west one would
// otherwise turn the zone inside out. The floor is a caller's decision (a screen-size question).
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
  // Destructured, not .map()ed — map() would widen the three-vertex guarantee back to Point[].
  const [a, b, c, ...rest] = polygon
  return [scale(a), scale(b), scale(c), ...rest.map(scale)]
}

type Edge = 'start' | 'end' | 'none'

// A degenerate axis yields the identity — dividing by a near-zero size would make the polygon NaN.
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

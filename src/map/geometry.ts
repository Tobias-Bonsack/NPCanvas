import type { Point, Polygon } from '../project/types.ts'

// World space is map-image pixels: the map image's natural size IS the coordinate system.
// Nothing here knows about the screen — that is viewport.ts.

export type Size = { width: number; height: number }
export type Rect = { x: number; y: number; width: number; height: number }

/**
 * Absolute tolerance in world units, i.e. map-image pixels. A boundary hit within a
 * thousandth of a pixel is a hit; anything looser would swallow genuinely-outside points
 * on the small polygons a user can draw at high zoom.
 */
const EPSILON = 1e-3

/**
 * Even-odd ray casting, with the boundary defined as **inside**.
 *
 * Parity alone answers vertices and edges arbitrarily — whether a grazing ray flips the
 * count depends on which side of the vertex the neighbouring edge happens to fall — so the
 * degenerate cases are decided exactly, up front, and never reach the parity loop.
 */
export function pointInPolygon(point: Point, polygon: Polygon): boolean {
  if (isOnBoundary(point, polygon)) return true

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    // Half-open vertical span (`a.y > y` vs `b.y > y`): a vertex shared by two edges lies
    // in exactly one of them, so a ray through it flips parity once rather than twice.
    if (a.y > point.y === b.y > point.y) continue
    const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x)
    if (point.x < crossX) inside = !inside
  }
  return inside
}

/** Boundary included, matching `pointInPolygon`. Hit-testing and visibility culling alike. */
export function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** Axis-aligned bounding box. Cheap reject before `pointInPolygon`, and zone hit-testing. */
export function polygonBounds(polygon: Polygon): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of polygon) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Unsigned shoelace area. Unsigned because zone-index ordering only compares magnitudes,
 * and a user-drawn polygon has no guaranteed winding direction to preserve.
 */
export function polygonArea(polygon: Polygon): number {
  let twiceSigned = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    twiceSigned += b.x * a.y - a.x * b.y
  }
  return Math.abs(twiceSigned) / 2
}

/** Area-weighted centroid — where a zone's label belongs. */
export function polygonCentroid(polygon: Polygon): Point {
  let twiceSigned = 0
  let x = 0
  let y = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const cross = b.x * a.y - a.x * b.y
    twiceSigned += cross
    x += (a.x + b.x) * cross
    y += (a.y + b.y) * cross
  }

  // A degenerate polygon (all vertices collinear, or all identical) has zero area, and the
  // weighted formula divides by it. The vertex average is the only meaningful answer left.
  if (Math.abs(twiceSigned) < EPSILON) return vertexAverage(polygon)
  return { x: x / (3 * twiceSigned), y: y / (3 * twiceSigned) }
}

/** Rectangles are 4-point polygons — there is deliberately no shape union. See CLAUDE.md. */
export function rectToPolygon(rect: Rect): Polygon {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ]
}

/** Normalized, so dragging up and to the left describes the same rectangle as down-right. */
export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/**
 * Grows a rectangle by `margin` of **its own size** on every side, not by `margin` units.
 * A viewport twice as wide therefore grows twice as much, which is what the culling margin
 * wants: the overscan is a fraction of what is on screen, at any zoom.
 */
export function inflate(rect: Rect, margin: number): Rect {
  const dx = rect.width * margin
  const dy = rect.height * margin
  return {
    x: rect.x - dx,
    y: rect.y - dy,
    width: rect.width + dx * 2,
    height: rect.height + dy * 2,
  }
}

/**
 * Whether two rectangles share any area, edges and corners counting as shared — the same
 * boundary-is-inside rule `rectContains` and `pointInPolygon` follow, so a zone exactly
 * touching the edge of the visible rect is drawn rather than culled.
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  )
}

/**
 * The polygon shifted by `delta`, in its own space. Destructured rather than `.map()`ed
 * because `Polygon` guarantees three vertices and `map` would widen it back to `Point[]`,
 * which is exactly the guarantee an `as` cast would throw away.
 */
export function translatePolygon(polygon: Polygon, delta: Point): Polygon {
  const shift = (point: Point): Point => ({ x: point.x + delta.x, y: point.y + delta.y })
  const [a, b, c, ...rest] = polygon
  return [shift(a), shift(b), shift(c), ...rest.map(shift)]
}

/** Vertex-wise equality. The reducer's no-op test, so a settled drag writes nothing. */
export function isSamePolygon(a: Polygon, b: Polygon): boolean {
  return (
    a.length === b.length &&
    a.every((point, index) => point.x === b[index].x && point.y === b[index].y)
  )
}

function vertexAverage(polygon: Polygon): Point {
  let x = 0
  let y = 0
  for (const point of polygon) {
    x += point.x
    y += point.y
  }
  return { x: x / polygon.length, y: y / polygon.length }
}

function isOnBoundary(point: Point, polygon: Polygon): boolean {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (isOnSegment(point, polygon[j], polygon[i])) return true
  }
  return false
}

function isOnSegment(point: Point, a: Point, b: Point): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  // A zero-length segment (duplicated vertex) reduces to a point comparison; the projection
  // below would divide by zero otherwise.
  if (lengthSquared < EPSILON * EPSILON) {
    return Math.hypot(point.x - a.x, point.y - a.y) <= EPSILON
  }

  // Perpendicular distance, not the raw cross product: the cross scales with segment length,
  // so comparing it to a fixed epsilon would make long edges arbitrarily "thick".
  const cross = dx * (point.y - a.y) - dy * (point.x - a.x)
  if (Math.abs(cross) / Math.sqrt(lengthSquared) > EPSILON) return false

  const projection = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
  return projection >= -EPSILON && projection <= 1 + EPSILON
}

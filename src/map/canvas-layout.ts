import type { GameMap, Point, Zone } from '../project/types.ts'
import type { Rect } from './geometry.ts'
import { pointInPolygon, polygonArea, polygonBounds, rectContains } from './geometry.ts'

// Canvas space is the shared system every map is placed into (one unit = one map pixel at
// scale 1); map-local is pixels within a single map image (Dialogue.position, Zone.polygon).
// Nothing here knows about the screen (viewport.ts) or the store.

export const MAP_LAYOUT_GAP = 200

export const MIN_MAP_SCALE = 0.1
export const MAX_MAP_SCALE = 10

// A NaN scale would make the map's whole transform NaN and render it nowhere with no error —
// collapse to native size instead, same as clampScale does for the viewport.
export function clampMapScale(scale: number): number {
  if (Number.isNaN(scale)) return 1
  return Math.min(MAX_MAP_SCALE, Math.max(MIN_MAP_SCALE, scale))
}

export function mapCanvasRect(map: GameMap): Rect {
  return {
    x: map.origin.x,
    y: map.origin.y,
    width: map.width * map.scale,
    height: map.height * map.scale,
  }
}

export function mapLocalToCanvas(map: GameMap, point: Point): Point {
  return {
    x: map.origin.x + point.x * map.scale,
    y: map.origin.y + point.y * map.scale,
  }
}

export function canvasToMapLocal(map: GameMap, point: Point): Point {
  return {
    x: (point.x - map.origin.x) / map.scale,
    y: (point.y - map.origin.y) / map.scale,
  }
}

// Converted once per map, not per pin — Dialogue.position/Zone.polygon are already map-local.
export function canvasRectToMapLocal(map: GameMap, rect: Rect): Rect {
  const topLeft = canvasToMapLocal(map, { x: rect.x, y: rect.y })
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width / map.scale,
    height: rect.height / map.scale,
  }
}

// Keeps the map's centre fixed under a rescale, rather than its top-left.
export function originForScale(map: GameMap, scale: number): Point {
  const rect = mapCanvasRect(map)
  return {
    x: rect.x + (rect.width - map.width * scale) / 2,
    y: rect.y + (rect.height - map.height * scale) / 2,
  }
}

export function zoneCanvasRect(map: GameMap, zone: Zone): Rect {
  const bounds = polygonBounds(zone.polygon)
  return {
    x: map.origin.x + bounds.x * map.scale,
    y: map.origin.y + bounds.y * map.scale,
    width: bounds.width * map.scale,
    height: bounds.height * map.scale,
  }
}

// `null`, not a zero rect, for an empty project — a caller must not fit to a degenerate rect.
export function mapsBounds(maps: readonly GameMap[]): Rect | null {
  if (maps.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const map of maps) {
    const rect = mapCanvasRect(map)
    if (rect.x < minX) minX = rect.x
    if (rect.y < minY) minY = rect.y
    if (rect.x + rect.width > maxX) maxX = rect.x + rect.width
    if (rect.y + rect.height > maxY) maxY = rect.y + rect.height
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// Topmost first — reversed because later maps paint over earlier ones in render order.
export function mapAtCanvasPoint(maps: readonly GameMap[], point: Point): GameMap | null {
  for (let index = maps.length - 1; index >= 0; index--) {
    const map = maps[index]
    if (rectContains(mapCanvasRect(map), point)) return map
  }
  return null
}

// Smallest zone first — the more specific region is what a click means. Only the topmost map is
// consulted, so a zone can never be picked through a map lying over it.
export function zoneAtCanvasPoint(
  maps: readonly GameMap[],
  zones: readonly Zone[],
  point: Point,
): Zone | null {
  const map = mapAtCanvasPoint(maps, point)
  if (map === null) return null

  const local = canvasToMapLocal(map, point)
  let best: Zone | null = null
  let bestArea = Infinity
  for (const zone of zones) {
    if (zone.mapId !== map.id) continue
    if (!rectContains(polygonBounds(zone.polygon), local)) continue
    if (!pointInPolygon(local, zone.polygon)) continue
    const area = polygonArea(zone.polygon)
    if (area >= bestArea) continue
    best = zone
    bestArea = area
  }
  return best
}

export function nextMapOrigin(maps: readonly GameMap[]): Point {
  const bounds = mapsBounds(maps)
  if (bounds === null) return { x: 0, y: 0 }
  return { x: bounds.x + bounds.width + MAP_LAYOUT_GAP, y: bounds.y }
}

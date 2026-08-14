import type { GameMap, Point } from '../project/types.ts'
import type { Rect } from './geometry.ts'

// Canvas space is the shared coordinate system every map is placed into; one canvas unit is
// one map pixel at `scale: 1`. Map-local space is pixels within a single map image, which is
// what `Dialogue.position` and `Zone.polygon` are expressed in — a map carries its contents
// because they are stored relative to it, never in canvas space.
//
// Nothing here knows about the screen (viewport.ts) or the store.

/**
 * Canvas units between neighbouring maps, both for the V1 migration and for a freshly
 * imported map. Wide enough that two maps read as separate objects when the whole canvas is
 * fitted on screen, narrow enough that the fit is not mostly empty space.
 */
export const MAP_LAYOUT_GAP = 200

/** Below 0.1 a map is a smudge on the canvas; above 10 it dwarfs every neighbour. */
const MIN_MAP_SCALE = 0.1
const MAX_MAP_SCALE = 10

/**
 * A NaN scale would make the map's whole transform NaN and render it nowhere, with no error
 * anywhere — it collapses to native size instead, the same absorb-rather-than-prevent
 * approach `clampScale` takes for the viewport.
 */
export function clampMapScale(scale: number): number {
  if (Number.isNaN(scale)) return 1
  return Math.min(MAX_MAP_SCALE, Math.max(MIN_MAP_SCALE, scale))
}

/** The map's footprint in canvas space: its natural size taken through its own scale. */
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

/**
 * The origin a map needs so that rescaling it keeps its **centre** fixed rather than its
 * top-left. Nudging a scale then reads as adjustment instead of the map drifting away from
 * wherever the user put it.
 */
export function originForScale(map: GameMap, scale: number): Point {
  const rect = mapCanvasRect(map)
  return {
    x: rect.x + (rect.width - map.width * scale) / 2,
    y: rect.y + (rect.height - map.height * scale) / 2,
  }
}

/**
 * The rectangle enclosing every map. `null` rather than a zero rect for an empty project, so
 * a caller cannot silently fit the viewport to a degenerate rectangle.
 */
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

/**
 * The map under a canvas point, topmost first — iterating in reverse, because the canvas
 * renders the array in order and later maps paint over earlier ones. `null` when the point
 * is on bare canvas, which is what stops a dialogue being placed nowhere.
 */
export function mapAtCanvasPoint(maps: readonly GameMap[], point: Point): GameMap | null {
  for (let index = maps.length - 1; index >= 0; index--) {
    const map = maps[index]
    const rect = mapCanvasRect(map)
    if (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    ) {
      return map
    }
  }
  return null
}

/**
 * Where a freshly imported map goes: to the right of everything already placed, top-aligned
 * with the current bounds. The placement policy lives here rather than in the media layer,
 * so importing and migrating lay maps out the same way.
 */
export function nextMapOrigin(maps: readonly GameMap[]): Point {
  const bounds = mapsBounds(maps)
  if (bounds === null) return { x: 0, y: 0 }
  return { x: bounds.x + bounds.width + MAP_LAYOUT_GAP, y: bounds.y }
}

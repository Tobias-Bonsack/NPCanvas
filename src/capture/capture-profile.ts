import { newCaptureProfileId } from '../project/ids.ts'
import type { CaptureProfile, PixelRect, Point } from '../project/types.ts'

// Three pixel spaces meet here, only converted between in this module: **frame** (the captured
// desktop/window, any size), **native** (the console's own screen, e.g. 160x144 — the space
// `CaptureProfile.textRect` is stored in, so the box doesn't move when the window does), and
// **tiles** (the 8x8 cells the console renders in, counted from native (0, 0)).

export const TILE_SIZE = 8

export const DEFAULT_NATIVE_WIDTH = 160
export const DEFAULT_NATIVE_HEIGHT = 144

// A half-finished calibration satisfies this too, since the calibration view draws the tile grid
// before a profile with an id and a name exists.
export type ScreenMapping = Pick<CaptureProfile, 'screenRect' | 'nativeWidth' | 'nativeHeight'>

// `frameWidth`/`frameHeight` record what the rects were measured against, so a profile can't be
// silently wrong on a resized window.
export type ProfileCalibration = Pick<
  CaptureProfile,
  'frameWidth' | 'frameHeight' | 'screenRect' | 'nativeWidth' | 'nativeHeight' | 'textRect'
>

export function screenScale(mapping: ScreenMapping): Point {
  return {
    x: mapping.screenRect.width / mapping.nativeWidth,
    y: mapping.screenRect.height / mapping.nativeHeight,
  }
}

export function tileStep(mapping: ScreenMapping): Point {
  const scale = screenScale(mapping)
  return { x: scale.x * TILE_SIZE, y: scale.y * TILE_SIZE }
}

export function nativeToFrame(mapping: ScreenMapping, rect: PixelRect): PixelRect {
  const scale = screenScale(mapping)
  return {
    x: mapping.screenRect.x + rect.x * scale.x,
    y: mapping.screenRect.y + rect.y * scale.y,
    width: rect.width * scale.x,
    height: rect.height * scale.y,
  }
}

export function frameToNative(mapping: ScreenMapping, rect: PixelRect): PixelRect {
  const scale = screenScale(mapping)
  return {
    x: (rect.x - mapping.screenRect.x) / scale.x,
    y: (rect.y - mapping.screenRect.y) / scale.y,
    width: rect.width / scale.x,
    height: rect.height / scale.y,
  }
}

// Grown outwards, not to nearest: a dragged rectangle claims what must be *inside* it, so rounding
// inward would clip the first column of glyphs. Always at least one tile.
export function snapToTileGrid(rect: PixelRect, bounds: { width: number; height: number }): PixelRect {
  const normalized = normalizeRect(rect)
  const x = snapAxis(normalized.x, normalized.width, bounds.width)
  const y = snapAxis(normalized.y, normalized.height, bounds.height)
  return { x: x.start, y: y.start, width: x.size, height: y.size }
}

// The mirror of `snapToTileGrid`, for the opposite claim: a detected text box is a region the
// glyphs are known to be inside of, so growing it outward would swallow the border.
export function snapInsideTileGrid(rect: PixelRect): PixelRect | null {
  const normalized = normalizeRect(rect)
  const x = snapInsideAxis(normalized.x, normalized.width)
  const y = snapInsideAxis(normalized.y, normalized.height)
  if (x === null || y === null) return null
  return { x: x.start, y: y.start, width: x.size, height: y.size }
}

// Exact, not approximate — one pixel of difference is a different window layout.
export function profileApplies(
  profile: CaptureProfile,
  frameWidth: number,
  frameHeight: number,
): boolean {
  return profile.frameWidth === frameWidth && profile.frameHeight === frameHeight
}

// Dragging up-left produces negative extents; normalized here rather than by every caller.
export function rectFromCorners(from: Point, to: Point): PixelRect {
  return normalizeRect({ x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y })
}

// A frame pixel is the finest thing the source can resolve, so fractional precision isn't real —
// and it would make the calibration view's number fields unusable to nudge.
export function roundRect(rect: PixelRect): PixelRect {
  const normalized = normalizeRect(rect)
  return {
    x: Math.round(normalized.x),
    y: Math.round(normalized.y),
    width: Math.round(normalized.width),
    height: Math.round(normalized.height),
  }
}

function normalizeRect(rect: PixelRect): PixelRect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

// The only place a profile is constructed — takes no alphabet, since that belongs to the project.
export function createCaptureProfile(
  name: string,
  calibration: ProfileCalibration,
): CaptureProfile {
  return { id: newCaptureProfileId(), name, ...calibration }
}

// Tile indices are clamped to the whole tiles the screen holds, so a native size not a multiple
// of 8 loses its ragged last column rather than producing a box whose edges sit inside a cell.
function snapAxis(start: number, size: number, bound: number): { start: number; size: number } {
  const tiles = Math.max(1, Math.floor(bound / TILE_SIZE))
  const first = clampTile(Math.floor(start / TILE_SIZE), tiles - 1)
  const last = clampTile(Math.ceil((start + size) / TILE_SIZE), tiles)
  const end = Math.max(last, first + 1)
  return { start: first * TILE_SIZE, size: (end - first) * TILE_SIZE }
}

function snapInsideAxis(start: number, size: number): { start: number; size: number } | null {
  const first = Math.ceil(start / TILE_SIZE)
  const last = Math.floor((start + size) / TILE_SIZE)
  if (last <= first) return null
  return { start: first * TILE_SIZE, size: (last - first) * TILE_SIZE }
}

function clampTile(tile: number, max: number): number {
  if (Number.isNaN(tile)) return 0
  return Math.min(max, Math.max(0, tile))
}

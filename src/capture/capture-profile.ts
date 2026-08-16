import { newCaptureProfileId } from '../project/ids.ts'
import type { CaptureProfile, PixelRect, Point } from '../project/types.ts'

// Three pixel spaces meet here, and only this module converts between them.
//
// **Frame** pixels are the captured desktop or window, whatever size the source happens to be.
// **Native** pixels are the console's own screen — 160 × 144 for a Game Boy — which is the space
// `CaptureProfile.textRect` is stored in, so the box does not move when the emulator window does.
// **Tiles** are the 8 × 8 cells the console renders in, counted from native (0, 0): once the
// screen rect is outlined the grid is a consequence of the hardware, not an estimate.
//
// Nothing here knows about the DOM, the store, or the live capture connection.

/** A console renders its font in 8 × 8 cells from (0, 0) of its screen. Not configurable. */
export const TILE_SIZE = 8

/** A Game Boy, because that is what this feature was built against. Editable per profile. */
export const DEFAULT_NATIVE_WIDTH = 160
export const DEFAULT_NATIVE_HEIGHT = 144

/**
 * What fixes the native ↔ frame mapping. A `CaptureProfile` satisfies it, and so does a
 * half-finished calibration — which is the point: the calibration view has to draw the tile grid
 * before a profile with an id and a name exists.
 */
export type ScreenMapping = Pick<CaptureProfile, 'screenRect' | 'nativeWidth' | 'nativeHeight'>

/**
 * Everything one calibration pass produces: a profile minus its identity and its alphabet.
 * `frameWidth`/`frameHeight` belong to it because they record what the rects were measured
 * against — a profile that forgot them could only be silently wrong on a resized window.
 */
export type ProfileCalibration = Pick<
  CaptureProfile,
  'frameWidth' | 'frameHeight' | 'screenRect' | 'nativeWidth' | 'nativeHeight' | 'textRect'
>

/** Frame pixels per native pixel, per axis. Non-integer in general — an emulator scales freely. */
export function screenScale(mapping: ScreenMapping): Point {
  return {
    x: mapping.screenRect.width / mapping.nativeWidth,
    y: mapping.screenRect.height / mapping.nativeHeight,
  }
}

/** Frame pixels per tile, per axis — what the calibration overlay steps its grid lines by. */
export function tileStep(mapping: ScreenMapping): Point {
  const scale = screenScale(mapping)
  return { x: scale.x * TILE_SIZE, y: scale.y * TILE_SIZE }
}

/** A native-pixel rectangle placed inside the captured frame. */
export function nativeToFrame(mapping: ScreenMapping, rect: PixelRect): PixelRect {
  const scale = screenScale(mapping)
  return {
    x: mapping.screenRect.x + rect.x * scale.x,
    y: mapping.screenRect.y + rect.y * scale.y,
    width: rect.width * scale.x,
    height: rect.height * scale.y,
  }
}

/** The inverse of `nativeToFrame` — what a rectangle dragged over the frame means natively. */
export function frameToNative(mapping: ScreenMapping, rect: PixelRect): PixelRect {
  const scale = screenScale(mapping)
  return {
    x: (rect.x - mapping.screenRect.x) / scale.x,
    y: (rect.y - mapping.screenRect.y) / scale.y,
    width: rect.width / scale.x,
    height: rect.height / scale.y,
  }
}

/**
 * A native-pixel rectangle grown outwards to whole tiles, and clamped to the screen.
 *
 * Outwards rather than nearest, because the rectangle the user dragged is a claim about what has
 * to be *inside* the box — rounding a sloppy edge inwards would clip the first column of glyphs
 * and produce unmatchable tiles. Always at least one tile: a click without a drag is a mistake,
 * not an empty selection.
 */
export function snapToTileGrid(rect: PixelRect, bounds: { width: number; height: number }): PixelRect {
  const normalized = normalizeRect(rect)
  const x = snapAxis(normalized.x, normalized.width, bounds.width)
  const y = snapAxis(normalized.y, normalized.height, bounds.height)
  return { x: x.start, y: y.start, width: x.size, height: y.size }
}

/**
 * Whether a profile still describes what is on screen. Exact, not approximate: one pixel of
 * difference is a different window layout, and reading glyphs out of pixels that moved is the
 * failure this check exists to make loud.
 */
export function profileApplies(
  profile: CaptureProfile,
  frameWidth: number,
  frameHeight: number,
): boolean {
  return profile.frameWidth === frameWidth && profile.frameHeight === frameHeight
}

/** The text box in frame pixels — what #53 reads its tiles out of, and what the overlay draws. */
export function textRectInFrame(profile: CaptureProfile): PixelRect {
  return nativeToFrame(profile, profile.textRect)
}

/**
 * A rectangle from two dragged corners, in whichever space the corners are in. Dragging up and
 * to the left is ordinary, so the negative extents it produces are normalized away here rather
 * than by every caller.
 */
export function rectFromCorners(from: Point, to: Point): PixelRect {
  return normalizeRect({ x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y })
}

/** The same rectangle with non-negative extents. */
export function normalizeRect(rect: PixelRect): PixelRect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

/** A new profile, with the empty alphabet #53 fills. The only place a profile is constructed. */
export function createCaptureProfile(
  name: string,
  calibration: ProfileCalibration,
): CaptureProfile {
  return { id: newCaptureProfileId(), name, ...calibration, glyphs: [] }
}

/**
 * One axis of `snapToTileGrid`. Tile indices are clamped to the whole tiles the screen holds,
 * so a native size that is not a multiple of 8 loses its ragged last column rather than
 * producing a box whose edges sit inside a cell.
 */
function snapAxis(start: number, size: number, bound: number): { start: number; size: number } {
  const tiles = Math.max(1, Math.floor(bound / TILE_SIZE))
  const first = clampTile(Math.floor(start / TILE_SIZE), tiles - 1)
  const last = clampTile(Math.ceil((start + size) / TILE_SIZE), tiles)
  const end = Math.max(last, first + 1)
  return { start: first * TILE_SIZE, size: (end - first) * TILE_SIZE }
}

function clampTile(tile: number, max: number): number {
  if (Number.isNaN(tile)) return 0
  return Math.min(max, Math.max(0, tile))
}

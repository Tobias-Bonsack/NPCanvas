import type { CaptureProfile, Glyph, PixelRect } from '../project/types.ts'
import { TILE_SIZE } from './capture-profile.ts'

// Reading a console text box, without an OCR dependency.
//
// A Game Boy font is not typography, it is a tile set: every character is an 8 × 8 bitmap on a
// fixed grid, drawn without anti-aliasing. Resampled back to native resolution each cell is
// exactly the bitmap the hardware drew, so recognition is a lookup rather than an inference.
//
// Everything here is pure — `capture-session.ts` produces the pixels, this decides what they say.

/**
 * The pixels this module reads, structurally.
 *
 * An `ImageData` satisfies it, which is what the app passes. Declared structurally rather than as
 * `ImageData` because the test environment is `node` (see CLAUDE.md § Testing scope) and Node has
 * no `ImageData` constructor — a synthetic frame would be unbuildable, and this pipeline is
 * exactly the code that has to be tested.
 */
export type PixelBuffer = {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

/** One 8 × 8 cell of the text box, and where it sits in the box's own tile grid. */
export type TileMask = {
  /** Tile column and row counted from the text rect's top-left, not from the screen's. */
  column: number
  row: number
  /** One byte per pixel row, most significant bit leftmost — the order `Glyph.bits` is written in. */
  rows: Uint8Array
}

/** A tile no glyph accounted for: what `GlyphLearner` shows and what typing into it names. */
export type UnknownTile = {
  column: number
  row: number
  /** The bitmap as 16 hex characters — already the shape a `Glyph` stores. */
  bits: string
  /** The line it appeared in, recognised characters only, with `UNKNOWN_MARK` where tiles were not. */
  context: string
}

/**
 * What one read of the text box produced.
 *
 * `text` is complete **only** when `unknown` is empty: an unrecognised tile contributes nothing
 * rather than a placeholder, because a guessed character silently corrupts everything downstream.
 * The flow is read → learn the unknowns → read the same frame again.
 */
export type TextBoxReading = {
  text: string
  unknown: UnknownTile[]
}

/**
 * How many of a tile's 64 bits may differ and still count as the same glyph.
 *
 * Not zero: the emulator scales by a non-integer factor and may smooth as it does, so a stroke's
 * outermost pixel can land on either side of the sample point. Well below the distance between
 * two real glyphs of a 8 × 8 font, which is what keeps this a tolerance rather than a guess.
 */
export const DEFAULT_MAX_DISTANCE = 4

/**
 * How close the runner-up may come before a match is refused.
 *
 * One bit of noise must never be able to turn the best candidate into the second best — if it
 * could, the answer is unknown, and asking is cheaper than a wrong character.
 */
const AMBIGUITY_MARGIN = 1

/** Stands in for an unrecognised tile in `UnknownTile.context`. Never enters a transcript. */
export const UNKNOWN_MARK = '▯'

const BYTES_PER_PIXEL = 4

/**
 * The console's own pixels, cut out of the captured frame.
 *
 * Nearest neighbour from the **centre** of each native pixel: at 7.18 × a native pixel covers
 * seven-odd frame pixels, and its centre is the one furthest from both neighbouring tiles.
 * Interpolating would average glyph edges into the background and make every tile a near miss.
 */
export function sampleNative(
  frame: PixelBuffer,
  screenRect: PixelRect,
  nativeWidth: number,
  nativeHeight: number,
): PixelBuffer {
  const data = new Uint8ClampedArray(nativeWidth * nativeHeight * BYTES_PER_PIXEL)
  const scaleX = screenRect.width / nativeWidth
  const scaleY = screenRect.height / nativeHeight

  for (let y = 0; y < nativeHeight; y++) {
    const sourceY = clamp(Math.floor(screenRect.y + (y + 0.5) * scaleY), frame.height - 1)
    for (let x = 0; x < nativeWidth; x++) {
      const sourceX = clamp(Math.floor(screenRect.x + (x + 0.5) * scaleX), frame.width - 1)
      const from = (sourceY * frame.width + sourceX) * BYTES_PER_PIXEL
      const to = (y * nativeWidth + x) * BYTES_PER_PIXEL
      data[to] = frame.data[from]
      data[to + 1] = frame.data[from + 1]
      data[to + 2] = frame.data[from + 2]
      data[to + 3] = frame.data[from + 3]
    }
  }

  return { width: nativeWidth, height: nativeHeight, data }
}

/**
 * Ink or background, one byte per pixel, `1` meaning ink.
 *
 * Ink is the darker class. A Game Boy text box is a light field with dark glyphs on it under
 * every palette — an SGB one makes the field off-white and the glyphs blue-black rather than
 * black, which moves both luminances but never their order.
 */
export function binarise(image: PixelBuffer, threshold: number): Uint8Array {
  const bits = new Uint8Array(image.width * image.height)
  for (let index = 0; index < bits.length; index++) {
    bits[index] = luminanceAt(image.data, index * BYTES_PER_PIXEL) <= threshold ? 1 : 0
  }
  return bits
}

/**
 * The luminance that separates ink from background, from the box's own pixels — Otsu's method.
 *
 * Derived rather than a constant because the palette is the game's business: an SGB border, a
 * GBC game and a fan translation all print a different pair of colours, and a per-game constant
 * would have to be calibrated by hand for each. Two classes with the largest separation between
 * them is exactly what a two-colour text box is.
 *
 * Returns `-1` for a uniform region — an empty box binarises to no ink at all, rather than to
 * half its pixels through a split that means nothing.
 */
export function inkThreshold(image: PixelBuffer, rect: PixelRect): number {
  const histogram = new Uint32Array(256)
  const left = clamp(Math.floor(rect.x), image.width - 1)
  const top = clamp(Math.floor(rect.y), image.height - 1)
  const right = Math.min(image.width, Math.floor(rect.x + rect.width))
  const bottom = Math.min(image.height, Math.floor(rect.y + rect.height))

  let total = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      histogram[luminanceAt(image.data, (y * image.width + x) * BYTES_PER_PIXEL)]++
      total++
    }
  }
  if (total === 0) return -1

  let sum = 0
  for (let level = 0; level < 256; level++) sum += level * histogram[level]

  let inkWeight = 0
  let inkSum = 0
  let bestVariance = 0
  let best = -1
  for (let level = 0; level < 256; level++) {
    inkWeight += histogram[level]
    if (inkWeight === 0) continue
    const fieldWeight = total - inkWeight
    if (fieldWeight === 0) break
    inkSum += level * histogram[level]
    const difference = inkSum / inkWeight - (sum - inkSum) / fieldWeight
    const variance = inkWeight * fieldWeight * difference * difference
    if (variance > bestVariance) {
      bestVariance = variance
      best = level
    }
  }
  return best
}

/**
 * The text rect cut into 8 × 8 cells, in reading order.
 *
 * A rect that is not a whole number of tiles loses its partial last column and row: a half cell
 * holds half a glyph, which can only ever be unmatchable. Anything outside the image counts as
 * background, so a rect nudged past the screen edge reads as spaces rather than throwing.
 */
export function readTiles(bits: Uint8Array, nativeWidth: number, textRect: PixelRect): TileMask[] {
  const height = Math.floor(bits.length / nativeWidth)
  const originX = Math.round(textRect.x)
  const originY = Math.round(textRect.y)
  const columns = Math.floor(textRect.width / TILE_SIZE)
  const rows = Math.floor(textRect.height / TILE_SIZE)

  const tiles: TileMask[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cell = new Uint8Array(TILE_SIZE)
      for (let y = 0; y < TILE_SIZE; y++) {
        const pixelY = originY + row * TILE_SIZE + y
        if (pixelY < 0 || pixelY >= height) continue
        let packed = 0
        for (let x = 0; x < TILE_SIZE; x++) {
          const pixelX = originX + column * TILE_SIZE + x
          if (pixelX < 0 || pixelX >= nativeWidth) continue
          if (bits[pixelY * nativeWidth + pixelX] === 1) packed |= 1 << (TILE_SIZE - 1 - x)
        }
        cell[y] = packed
      }
      tiles.push({ column, row, rows: cell })
    }
  }
  return tiles
}

/**
 * The glyph a tile is, or `null` for "ask".
 *
 * Refused on two counts: nothing close enough, and two candidates so close that the difference
 * between them is within the noise the tolerance exists to absorb. Candidates spelling the same
 * character do not compete — re-learning a tile is a correction, not an ambiguity.
 */
export function matchGlyph(
  tile: TileMask,
  glyphs: readonly Glyph[],
  maxDistance: number = DEFAULT_MAX_DISTANCE,
): Glyph | null {
  let best: Glyph | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const distances: { glyph: Glyph; distance: number }[] = []

  for (const glyph of glyphs) {
    const rows = parseGlyphBits(glyph.bits)
    // A bitmap that is not 16 hex characters was hand-edited into `data.json`; it names no tile.
    if (rows === null) continue
    const distance = hammingDistance(tile.rows, rows)
    distances.push({ glyph, distance })
    if (distance < bestDistance) {
      bestDistance = distance
      best = glyph
    }
  }

  if (best === null || bestDistance > maxDistance) return null
  for (const candidate of distances) {
    if (candidate.glyph.char === best.char) continue
    if (candidate.distance - bestDistance <= AMBIGUITY_MARGIN) return null
  }
  return best
}

/**
 * A whole text box, as a transcript plus whatever it could not name.
 *
 * Lines are joined with a single space and trimmed first: Pokémon Gen 1 breaks between words and
 * never inside one, so a line end is always a word boundary. A line of nothing but background
 * disappears entirely rather than contributing a second space.
 */
export function readTextBox(frame: PixelBuffer, profile: CaptureProfile): TextBoxReading {
  const native = sampleNative(frame, profile.screenRect, profile.nativeWidth, profile.nativeHeight)
  const bits = binarise(native, inkThreshold(native, profile.textRect))
  const tiles = readTiles(bits, profile.nativeWidth, profile.textRect)

  const lines: string[] = []
  const contexts: string[] = []
  const pending: Omit<UnknownTile, 'context'>[] = []
  for (const tile of tiles) {
    const line = tile.row
    lines[line] ??= ''
    contexts[line] ??= ''

    // Background only: a space, and never a question. Every text box is mostly empty cells, and
    // asking about them would bury the handful of tiles that are actually a new character.
    if (isEmpty(tile)) {
      lines[line] += ' '
      contexts[line] += ' '
      continue
    }

    const glyph = matchGlyph(tile, profile.glyphs)
    if (glyph === null) {
      // Contributes nothing: `text` is only ever complete when `unknown` is empty.
      pending.push({ column: tile.column, row: tile.row, bits: toGlyphBits(tile.rows) })
      contexts[line] += UNKNOWN_MARK
      continue
    }
    // An empty `char` is a glyph that is not text — the blinking continuation arrow.
    lines[line] += glyph.char
    contexts[line] += glyph.char
  }

  const unknown: UnknownTile[] = []
  const seen = new Set<string>()
  for (const tile of pending) {
    // One prompt per distinct bitmap: a line with three unrecognised `e`s is one character to
    // learn, and typing it in three times would be a chore that teaches the profile nothing more.
    if (seen.has(tile.bits)) continue
    seen.add(tile.bits)
    unknown.push({ ...tile, context: (contexts[tile.row] ?? '').trim() })
  }

  const text = lines
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
  return { text, unknown }
}

/**
 * An alphabet with newly learned tiles folded into it.
 *
 * A bitmap that is already known is replaced rather than appended beside: two glyphs with
 * identical bits and different characters would be permanently ambiguous, so the tile could never
 * be read again. Re-learning is therefore the correction path, and the reducer and the live
 * re-read after learning both go through here so they cannot disagree about what was learned.
 */
export function mergeGlyphs(existing: readonly Glyph[], learned: readonly Glyph[]): Glyph[] {
  const replacements = new Map(learned.map((glyph) => [glyph.bits, glyph]))
  const known = new Set(existing.map((glyph) => glyph.bits))
  return [
    ...existing.map((glyph) => replacements.get(glyph.bits) ?? glyph),
    ...learned.filter((glyph) => !known.has(glyph.bits)),
  ]
}

/** The 16 hex characters a `Glyph` stores, from a tile's rows. */
export function toGlyphBits(rows: Uint8Array): string {
  let hex = ''
  for (let row = 0; row < TILE_SIZE; row++) hex += (rows[row] ?? 0).toString(16).padStart(2, '0')
  return hex
}

/** The inverse, or `null` when the string is not exactly 16 hex characters. */
export function parseGlyphBits(bits: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]{16}$/.test(bits)) return null
  const rows = new Uint8Array(TILE_SIZE)
  for (let row = 0; row < TILE_SIZE; row++) {
    rows[row] = Number.parseInt(bits.slice(row * 2, row * 2 + 2), 16)
  }
  return rows
}

/** Whether the pixel at `column`, `row` of a bitmap is ink — what the learner draws a tile from. */
export function isGlyphPixelSet(rows: Uint8Array, column: number, row: number): boolean {
  return (((rows[row] ?? 0) >> (TILE_SIZE - 1 - column)) & 1) === 1
}

function isEmpty(tile: TileMask): boolean {
  return tile.rows.every((row) => row === 0)
}

function hammingDistance(left: Uint8Array, right: Uint8Array): number {
  let distance = 0
  for (let row = 0; row < TILE_SIZE; row++) distance += popcount(left[row] ^ right[row])
  return distance
}

function popcount(byte: number): number {
  let bits = byte
  let count = 0
  while (bits !== 0) {
    bits &= bits - 1
    count++
  }
  return count
}

/** Rec. 601 luma, in integers: the same weighting a CRT applied, which is what these fonts assume. */
function luminanceAt(data: Uint8ClampedArray, offset: number): number {
  return Math.round((data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000)
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(0, value))
}

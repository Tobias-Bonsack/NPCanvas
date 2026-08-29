import type { CaptureProfile, CaptureProfileId, Glyph, PixelRect, Point } from '../project/types.ts'
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

/**
 * The text rect's cells, in reading order, as offsets into one flat buffer rather than an object
 * per cell — a cell is eight bytes at a known offset, and `column`/`row` are `index % columns` and
 * `Math.floor(index / columns)`, which arithmetic gives for free. `cells` holds `TILE_SIZE` bytes
 * per cell, most significant bit leftmost within a row — the order `Glyph.bits` is written in.
 */
export type TileGrid = {
  columns: number
  rows: number
  cells: Uint8Array
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
  /**
   * How many tiles could not be named at all, **before** deduplication — `unknown` holds one entry
   * per distinct bitmap, so a line with three unrecognised `e`s has one entry and three here.
   *
   * The count is how a watcher tells a box that is still typing itself out from one that is merely
   * blinking: the number of unnamed tiles only ever grows while a box fills, and a repeated bitmap
   * adds nothing to `unknown` at all. See `box-settle.ts`.
   */
  unreadable: number
}

/** Stands in for an unrecognised tile in `UnknownTile.context`. Never enters a transcript. */
const UNKNOWN_MARK = '▯'

const BYTES_PER_PIXEL = 4

/** `frame` is the whole frame unless a caller names where a crop of it sits. */
const ORIGIN_ZERO: Point = { x: 0, y: 0 }

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
  /** `screenRect`'s own frame is not always `frame`'s: a caller reading a crop passes the crop's
   * top-left in frame coordinates, so `screenRect` still names the same pixels it always has. */
  origin: Point = ORIGIN_ZERO,
  /** Written into instead of allocating, when given and the right size — see `readTextBox`'s scratch. */
  dest?: Uint8ClampedArray,
): PixelBuffer {
  const data = dest ?? new Uint8ClampedArray(nativeWidth * nativeHeight * BYTES_PER_PIXEL)
  const rectX = screenRect.x - origin.x
  const rectY = screenRect.y - origin.y
  const scaleX = screenRect.width / nativeWidth
  const scaleY = screenRect.height / nativeHeight

  for (let y = 0; y < nativeHeight; y++) {
    const sourceY = clamp(Math.floor(rectY + (y + 0.5) * scaleY), frame.height - 1)
    for (let x = 0; x < nativeWidth; x++) {
      const sourceX = clamp(Math.floor(rectX + (x + 0.5) * scaleX), frame.width - 1)
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
 * Ink or background, one byte per pixel, `1` meaning ink — the whole image, or just `rect` of it.
 *
 * Ink is the darker class. A Game Boy text box is a light field with dark glyphs on it under
 * every palette — an SGB one makes the field off-white and the glyphs blue-black rather than
 * black, which moves both luminances but never their order.
 *
 * With no `rect` this binarises every pixel, exactly as before — what keeps every existing caller
 * working. With one, the returned buffer is sized to `rect` itself (rounded), not to `image`: a
 * caller reading one small text box out of a much larger frame writes only the rows it will ever
 * read. A `rect` that reaches past the image's edge still returns a buffer of its own full size;
 * the pixels that would have fallen outside the image are left `0` — background — rather than
 * throwing, which is the same tolerance a text box calibrated against a differently sized window
 * already relies on.
 */
export function binarise(
  image: PixelBuffer,
  threshold: number,
  rect?: PixelRect,
  /** Written into instead of allocating, when given and the right size — see `readTextBox`'s scratch. */
  dest?: Uint8Array,
): Uint8Array {
  const region = rect ?? { x: 0, y: 0, width: image.width, height: image.height }
  const originX = Math.round(region.x)
  const originY = Math.round(region.y)
  const width = Math.round(region.width)
  const height = Math.round(region.height)
  const bits = dest ?? new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const imageY = originY + y
    for (let x = 0; x < width; x++) {
      const imageX = originX + x
      // Every cell is written unconditionally, in bounds or not — `dest` may carry a previous
      // call's bits, and a cell that merely stays out of bounds must read as background rather
      // than keep whatever that call left behind.
      bits[y * width + x] =
        imageY < 0 ||
        imageY >= image.height ||
        imageX < 0 ||
        imageX >= image.width ||
        luminanceAt(image.data, (imageY * image.width + imageX) * BYTES_PER_PIXEL) > threshold
          ? 0
          : 1
    }
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
 * `bits` is addressed through the rectangle's **own** origin and stride, not the screen's: it is
 * `binarise`'s rect-sized output, whose `(0, 0)` already **is** `textRect`'s top-left. `stride` is
 * that buffer's own row width, which `binarise` rounds `textRect.width` to.
 *
 * A rect that is not a whole number of tiles loses its partial last column and row: a half cell
 * holds half a glyph, which can only ever be unmatchable. Anything outside `bits` counts as
 * background, so a rect nudged past the screen edge reads as spaces rather than throwing.
 */
export function readTiles(
  bits: Uint8Array,
  stride: number,
  textRect: PixelRect,
  /** Written into instead of allocating, when given and the right size — see `readTextBox`'s scratch. */
  dest?: TileGrid,
): TileGrid {
  const height = Math.floor(bits.length / stride)
  const columns = Math.floor(textRect.width / TILE_SIZE)
  const rows = Math.floor(textRect.height / TILE_SIZE)
  const grid =
    dest !== undefined && dest.columns === columns && dest.rows === rows
      ? dest
      : { columns, rows, cells: new Uint8Array(columns * rows * TILE_SIZE) }

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cellOffset = (row * columns + column) * TILE_SIZE
      for (let y = 0; y < TILE_SIZE; y++) {
        const pixelY = row * TILE_SIZE + y
        let packed = 0
        if (pixelY >= 0 && pixelY < height) {
          for (let x = 0; x < TILE_SIZE; x++) {
            const pixelX = column * TILE_SIZE + x
            if (pixelX < 0 || pixelX >= stride) continue
            if (bits[pixelY * stride + pixelX] === 1) packed |= 1 << (TILE_SIZE - 1 - x)
          }
        }
        // Written unconditionally, exactly like `binarise`: a reused `grid` may carry an earlier
        // call's bits, and a row that falls out of bounds must read as background, not stale ink.
        grid.cells[cellOffset + y] = packed
      }
    }
  }
  return grid
}

/**
 * The glyph a tile is, or `null` for "ask".
 *
 * Bit-exact, or nothing. A Game Boy font is a tile set drawn without anti-aliasing, so a correctly
 * sampled cell *is* the bitmap the hardware drew — every character of a real capture matches at
 * distance zero, and the ones that do not are the ones the alphabet has never been taught.
 *
 * A tolerance therefore does not absorb noise, it invents characters, and silently: the Gen 1 font
 * puts `R` and `F` three bits from `P` and `é` two from `e`, so a four-bit tolerance read
 * "PPOPESSOP!" for "PROFESSOR!" — every letter it had not learned yet resolved to the nearest one
 * it had, with nothing downstream able to tell a guess from a reading. Refusing costs one prompt
 * from the learner; guessing costs a transcript that looks complete and is wrong.
 *
 * The refusal is self-healing, which is what lets it be this strict: a tile the emulator did smudge
 * is simply learned again, and two bitmaps may spell the same character. `mergeGlyphs` replaces on
 * identical bits, so at most one glyph can ever match — the first hit is the only hit.
 */
export function matchGlyph(rows: Uint8Array, glyphs: readonly Glyph[]): Glyph | null {
  return glyphIndex(glyphs).get(toGlyphBits(rows)) ?? null
}

/**
 * `glyphs`, keyed by its own normalised bitmap — built once per array **identity**, the pattern
 * `src/map/zone-index.ts:277-282` caches its candidates with. A learned tile changes `glyphs`'
 * identity (`mergeGlyphs`/`forgetGlyph` both return a new array), so the very next read sees it.
 *
 * The key is the same `toGlyphBits(parseGlyphBits(bits))` round trip `matchGlyph` compared through
 * before this cache existed, so an upper-case `bits` entry still matches and one that is not 16 hex
 * characters is skipped rather than throwing. `mergeGlyphs` guarantees at most one glyph can match
 * any bitmap, so which occurrence wins on a collision never arises in practice — the first is kept.
 */
function glyphIndex(glyphs: readonly Glyph[]): ReadonlyMap<string, Glyph> {
  if (cachedGlyphIndex !== null && cachedGlyphIndex.glyphs === glyphs) return cachedGlyphIndex.byBits
  const byBits = new Map<string, Glyph>()
  for (const glyph of glyphs) {
    const rows = parseGlyphBits(glyph.bits)
    if (rows === null) continue
    const key = toGlyphBits(rows)
    if (!byBits.has(key)) byBits.set(key, glyph)
  }
  cachedGlyphIndex = { glyphs, byBits }
  return byBits
}

let cachedGlyphIndex: { glyphs: readonly Glyph[]; byBits: ReadonlyMap<string, Glyph> } | null = null

/**
 * A whole text box, as a transcript plus whatever it could not name.
 *
 * The alphabet is a separate argument because a profile does not carry one: a profile says where
 * to read pixels, and the font is the console's, shared by every profile aimed at it.
 *
 * Lines are joined with a single space and trimmed first: Pokémon Gen 1 breaks between words and
 * never inside one, so a line end is always a word boundary. A line of nothing but background
 * disappears entirely rather than contributing a second space.
 */
export function readTextBox(
  frame: PixelBuffer,
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
  /** Where `frame` sits in frame coordinates, when it is a crop rather than the whole frame. */
  origin: Point = ORIGIN_ZERO,
): TextBoxReading {
  const scratch = scratchFor(profile)
  const native = sampleNative(
    frame,
    profile.screenRect,
    profile.nativeWidth,
    profile.nativeHeight,
    origin,
    scratch.native,
  )
  const region = regionBytes(native, profile.textRect, scratch.region)

  if (
    cachedRead !== null &&
    cachedRead.profileId === profile.id &&
    cachedRead.glyphs === glyphs &&
    bytesEqual(cachedRead.region, region)
  ) {
    return cachedRead.reading
  }

  const reading = readTextBoxUncached(native, profile, glyphs, scratch)
  // A copy, never `scratch.region` itself: the very next call overwrites that buffer in place,
  // which would otherwise make this comparison compare a buffer against its own later self.
  cachedRead = { profileId: profile.id, glyphs, region: region.slice(), reading }
  return reading
}

/**
 * The buffers one `readTextBox` call needs, reused across ticks instead of allocated fresh —
 * `sampleNative`'s native-resolution image, the cache comparison's region copy, `binarise`'s bits
 * and `readTiles`' tile grid. Kept as a **single** slot: reallocated whole whenever any dimension
 * it was built for no longer matches, which happens only on a profile switch, never tick to tick.
 */
type ReadScratch = {
  nativeWidth: number
  nativeHeight: number
  regionWidth: number
  regionHeight: number
  native: Uint8ClampedArray
  region: Uint8ClampedArray
  bits: Uint8Array
  grid: TileGrid
}

let scratch: ReadScratch | null = null

function scratchFor(profile: CaptureProfile): ReadScratch {
  const nativeWidth = profile.nativeWidth
  const nativeHeight = profile.nativeHeight
  const regionWidth = Math.round(profile.textRect.width)
  const regionHeight = Math.round(profile.textRect.height)
  const columns = Math.floor(profile.textRect.width / TILE_SIZE)
  const rows = Math.floor(profile.textRect.height / TILE_SIZE)

  if (
    scratch !== null &&
    scratch.nativeWidth === nativeWidth &&
    scratch.nativeHeight === nativeHeight &&
    scratch.regionWidth === regionWidth &&
    scratch.regionHeight === regionHeight &&
    scratch.grid.columns === columns &&
    scratch.grid.rows === rows
  ) {
    return scratch
  }

  scratch = {
    nativeWidth,
    nativeHeight,
    regionWidth,
    regionHeight,
    native: new Uint8ClampedArray(nativeWidth * nativeHeight * BYTES_PER_PIXEL),
    region: new Uint8ClampedArray(regionWidth * regionHeight * BYTES_PER_PIXEL),
    bits: new Uint8Array(regionWidth * regionHeight),
    grid: { columns, rows, cells: new Uint8Array(columns * rows * TILE_SIZE) },
  }
  return scratch
}

/**
 * One-slot memo of the last box read: the same pixels, under the same profile and the same
 * alphabet, are the same reading — every stage downstream of `sampleNative` is pure. Most ticks
 * of the watcher's loop read a box that has not moved for as long as a player takes to read it,
 * so this turns tens of ticks of `inkThreshold` + `binarise` + `readTiles` + `matchGlyph` into one.
 *
 * `region` is the `textRect`'s own bytes out of the **native** image, compared before any of that
 * runs — cheaper than `inkThreshold`'s histogram alone, and a miss on it skips every stage after.
 * `profileId`/`glyphs` are what a changed profile or a newly learned tile invalidate against: a
 * cache hit is by construction the reading the pipeline would have produced, because the inputs
 * that could have changed it are exactly the ones compared.
 *
 * Many held frames read in one pass (`heldUnknownTiles`, `replayHeldFrames`) naturally miss this
 * on every one of them: each is a different frame, so its `region` differs from whichever frame
 * populated the slot last — a single slot never needs to remember more than the one most recent.
 */
let cachedRead: {
  profileId: CaptureProfileId
  glyphs: readonly Glyph[]
  region: Uint8ClampedArray
  reading: TextBoxReading
} | null = null

function readTextBoxUncached(
  native: PixelBuffer,
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
  scratch: ReadScratch,
): TextBoxReading {
  const bits = binarise(native, inkThreshold(native, profile.textRect), profile.textRect, scratch.bits)
  const grid = readTiles(bits, Math.round(profile.textRect.width), profile.textRect, scratch.grid)

  const lines: string[] = []
  const contexts: string[] = []
  const pending: Omit<UnknownTile, 'context'>[] = []
  for (let index = 0; index < grid.columns * grid.rows; index++) {
    const column = index % grid.columns
    const row = Math.floor(index / grid.columns)
    // A view into `grid.cells`, not a copy — nothing here retains it past this loop body, so no
    // allocation is needed to read eight bytes at a known offset.
    const cell = grid.cells.subarray(index * TILE_SIZE, index * TILE_SIZE + TILE_SIZE)
    lines[row] ??= ''
    contexts[row] ??= ''

    // Background only: a space, and never a question. Every text box is mostly empty cells, and
    // asking about them would bury the handful of tiles that are actually a new character.
    if (isEmpty(cell)) {
      lines[row] += ' '
      contexts[row] += ' '
      continue
    }

    const glyph = matchGlyph(cell, glyphs)
    if (glyph === null) {
      // Contributes nothing: `text` is only ever complete when `unknown` is empty.
      pending.push({ column, row, bits: toGlyphBits(cell) })
      contexts[row] += UNKNOWN_MARK
      continue
    }
    // An empty `char` is a glyph that is not text — the blinking continuation arrow.
    lines[row] += glyph.char
    contexts[row] += glyph.char
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
  return { text, unknown, unreadable: pending.length }
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

/**
 * An alphabet with one bitmap taken out of it — the mirror of `mergeGlyphs`, and the only removal
 * path there is.
 *
 * Keyed on the bitmap through `toGlyphBits(parseGlyphBits(...))`, exactly as `matchGlyph` compares,
 * so an entry hand-written into `data.json` in upper case is still the one this removes. Returns
 * the array it was given when nothing matched, which is how the reducer tells a real removal from
 * a request for a bitmap the project never learned — the difference between one undo step and none.
 *
 * Removal exists because re-learning cannot reach every mistake: a tile wrongly marked *not text*
 * matches silently from then on and never reappears in `unknown`, so the learner would never ask
 * about it again.
 */
export function forgetGlyph(glyphs: Glyph[], bits: string): Glyph[] {
  const rows = parseGlyphBits(bits)
  if (rows === null) return glyphs
  const target = toGlyphBits(rows)
  const kept = glyphs.filter((glyph) => {
    const own = parseGlyphBits(glyph.bits)
    return own === null || toGlyphBits(own) !== target
  })
  return kept.length === glyphs.length ? glyphs : kept
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

function isEmpty(rows: Uint8Array): boolean {
  return rows.every((row) => row === 0)
}

/** Rec. 601 luma, in integers: the same weighting a CRT applied, which is what these fonts assume. */
export function luminanceAt(data: Uint8ClampedArray, offset: number): number {
  return Math.round((data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000)
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(0, value))
}

/**
 * `rect`'s own RGBA bytes out of `image`, rounded and clamped exactly as `binarise` clamps —
 * outside `image` reads as `0`, never a throw. What `readTextBox`'s cache compares: two equal
 * results here mean `inkThreshold`, `binarise`, `readTiles` and every `matchGlyph` call downstream
 * would produce byte-identical output too, since none of them reads anything outside this region.
 */
function regionBytes(image: PixelBuffer, rect: PixelRect, dest?: Uint8ClampedArray): Uint8ClampedArray {
  const originX = Math.round(rect.x)
  const originY = Math.round(rect.y)
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  const bytes = dest ?? new Uint8ClampedArray(width * height * BYTES_PER_PIXEL)
  for (let y = 0; y < height; y++) {
    const imageY = originY + y
    for (let x = 0; x < width; x++) {
      const imageX = originX + x
      const to = (y * width + x) * BYTES_PER_PIXEL
      // Written unconditionally, exactly like `binarise`: a reused `dest` may carry a previous
      // call's bytes at a cell that is now out of bounds, and it must read as `0`, not stale ink.
      if (imageY < 0 || imageY >= image.height || imageX < 0 || imageX >= image.width) {
        bytes[to] = 0
        bytes[to + 1] = 0
        bytes[to + 2] = 0
        bytes[to + 3] = 0
        continue
      }
      const from = (imageY * image.width + imageX) * BYTES_PER_PIXEL
      bytes[to] = image.data[from]
      bytes[to + 1] = image.data[from + 1]
      bytes[to + 2] = image.data[from + 2]
      bytes[to + 3] = image.data[from + 3]
    }
  }
  return bytes
}

function bytesEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false
  }
  return true
}

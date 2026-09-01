import type { CaptureProfile, CaptureProfileId, Glyph, PixelRect, Point } from '../project/types.ts'
import { TILE_SIZE } from './capture-profile.ts'

// A Game Boy font is a tile set, not typography: every character is an 8x8 bitmap on a fixed grid
// with no anti-aliasing, so recognition is a lookup rather than an OCR inference.

// Declared structurally, not as `ImageData`: the test environment is `node` (CLAUDE.md § Testing
// scope) and Node has no `ImageData` constructor, so a synthetic frame needs a plain object shape.
export type PixelBuffer = {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

// Offsets into one flat buffer rather than an object per cell; `cells` holds `TILE_SIZE` bytes per
// cell, MSB leftmost per row — the order `Glyph.bits` is written in.
export type TileGrid = {
  columns: number
  rows: number
  cells: Uint8Array
}

export type UnknownTile = {
  column: number
  row: number
  bits: string
  context: string
}

// `text` is complete only when `unknown` is empty — an unrecognised tile contributes nothing
// rather than a placeholder, since a guessed character would silently corrupt everything downstream.
export type TextBoxReading = {
  text: string
  unknown: UnknownTile[]
  // Count of unnamed tiles before dedup, vs. `unknown`'s one-per-bitmap: how `box-settle.ts` tells
  // a box still typing itself out from one merely blinking.
  unreadable: number
}

const UNKNOWN_MARK = '▯'

const BYTES_PER_PIXEL = 4

const ORIGIN_ZERO: Point = { x: 0, y: 0 }

// Nearest neighbour from the **centre** of each native pixel, not interpolated: interpolating
// would average glyph edges into the background and make every tile a near miss instead of exact.
export function sampleNative(
  frame: PixelBuffer,
  screenRect: PixelRect,
  nativeWidth: number,
  nativeHeight: number,
  origin: Point = ORIGIN_ZERO,
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

// Ink or background, one byte per pixel, `1` meaning ink, over `rect` (or the whole image). Ink is
// the darker class — every palette (including SGB) keeps glyphs darker than the field even though
// the actual colours differ. A rect reaching past the image's edge reads as background rather than throwing.
export function binarise(
  image: PixelBuffer,
  threshold: number,
  rect?: PixelRect,
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
      // Written unconditionally: a reused `dest` may carry a previous call's bits, and an
      // out-of-bounds cell must read as background rather than keep stale data.
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

// Otsu's method: derived per-read rather than a constant, since the palette is the game's own
// business (SGB, GBC, and fan translations each print a different pair of colours). Returns `-1`
// for a uniform region — an empty box binarises to no ink, not to half its pixels arbitrarily.
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

// `bits` is addressed through the rect's own origin/stride, since it's `binarise`'s rect-sized
// output whose `(0, 0)` already is `textRect`'s top-left. A rect not a whole number of tiles loses
// its partial last column/row — a half cell can only ever be unmatchable.
export function readTiles(
  bits: Uint8Array,
  stride: number,
  textRect: PixelRect,
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
        // Written unconditionally, exactly like `binarise` — a reused `grid` must not keep stale ink.
        grid.cells[cellOffset + y] = packed
      }
    }
  }
  return grid
}

// Bit-exact match, or `null` — no tolerance: a correctly sampled cell *is* the hardware's bitmap,
// so a near-miss means an untaught character. A four-bit tolerance was tried and silently read
// "PPOPESSOP!" for "PROFESSOR!"; refusing costs one learner prompt, guessing costs a wrong transcript.
export function matchGlyph(rows: Uint8Array, glyphs: readonly Glyph[]): Glyph | null {
  return glyphIndex(glyphs).get(toGlyphBits(rows)) ?? null
}

// Keyed by normalised bitmap, cached once per array **identity** — `mergeGlyphs`/`forgetGlyph`
// both return a new array, so a learned tile invalidates the cache on the very next read.
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

// `native` is the screen at its own resolution — `grabNativeFrame` hands the browser the downscale
// (`capture-session.ts`), so nothing here ever sees the upscaled frame. `glyphs` is a separate
// argument because a profile doesn't carry one — the font is the console's, shared by every profile
// aimed at it. Lines join with a single space; Pokémon Gen 1 breaks between words and never inside
// one, so a line end is always a word boundary.
export function readTextBox(
  native: PixelBuffer,
  profile: CaptureProfile,
  glyphs: readonly Glyph[],
): TextBoxReading {
  const scratch = scratchFor(profile)
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
  // A copy, never `scratch.region` itself — the next call overwrites that buffer in place.
  cachedRead = { profileId: profile.id, glyphs, region: region.slice(), reading }
  return reading
}

// Reused across ticks instead of allocated fresh; reallocated whole only on a profile switch,
// never tick to tick.
type ReadScratch = {
  regionWidth: number
  regionHeight: number
  region: Uint8ClampedArray
  bits: Uint8Array
  grid: TileGrid
}

let scratch: ReadScratch | null = null

function scratchFor(profile: CaptureProfile): ReadScratch {
  const regionWidth = Math.round(profile.textRect.width)
  const regionHeight = Math.round(profile.textRect.height)
  const columns = Math.floor(profile.textRect.width / TILE_SIZE)
  const rows = Math.floor(profile.textRect.height / TILE_SIZE)

  if (
    scratch !== null &&
    scratch.regionWidth === regionWidth &&
    scratch.regionHeight === regionHeight &&
    scratch.grid.columns === columns &&
    scratch.grid.rows === rows
  ) {
    return scratch
  }

  scratch = {
    regionWidth,
    regionHeight,
    region: new Uint8ClampedArray(regionWidth * regionHeight * BYTES_PER_PIXEL),
    bits: new Uint8Array(regionWidth * regionHeight),
    grid: { columns, rows, cells: new Uint8Array(columns * rows * TILE_SIZE) },
  }
  return scratch
}

// One-slot memo of the last box read: most watcher ticks read a box unchanged since the player
// last saw it, so this turns tens of ticks of the whole read pipeline into one. `region` (the
// native-image bytes under `textRect`) is compared first, since it's cheaper than the pipeline itself.
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
    // A view into `grid.cells`, not a copy — nothing retains it past this loop body.
    const cell = grid.cells.subarray(index * TILE_SIZE, index * TILE_SIZE + TILE_SIZE)
    lines[row] ??= ''
    contexts[row] ??= ''

    // Background only: a space, never a question — most cells are empty, and asking about them
    // would bury the handful of tiles that are actually a new character.
    if (isEmpty(cell)) {
      lines[row] += ' '
      contexts[row] += ' '
      continue
    }

    const glyph = matchGlyph(cell, glyphs)
    if (glyph === null) {
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
    // One prompt per distinct bitmap.
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

// Replaces on an already-known bitmap rather than appending beside it — two glyphs with identical
// bits and different characters would be permanently ambiguous. This makes re-learning the correction path.
export function mergeGlyphs(existing: readonly Glyph[], learned: readonly Glyph[]): Glyph[] {
  const replacements = new Map(learned.map((glyph) => [glyph.bits, glyph]))
  const known = new Set(existing.map((glyph) => glyph.bits))
  return [
    ...existing.map((glyph) => replacements.get(glyph.bits) ?? glyph),
    ...learned.filter((glyph) => !known.has(glyph.bits)),
  ]
}

// The only removal path — needed because re-learning can't reach every mistake: a tile wrongly
// marked *not text* matches silently forever and never reappears in `unknown` to be re-taught.
// Returns the array unchanged when nothing matched, so the reducer spends no undo step on a no-op.
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

export function toGlyphBits(rows: Uint8Array): string {
  let hex = ''
  for (let row = 0; row < TILE_SIZE; row++) hex += (rows[row] ?? 0).toString(16).padStart(2, '0')
  return hex
}

// `null` when the string is not exactly 16 hex characters.
export function parseGlyphBits(bits: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]{16}$/.test(bits)) return null
  const rows = new Uint8Array(TILE_SIZE)
  for (let row = 0; row < TILE_SIZE; row++) {
    rows[row] = Number.parseInt(bits.slice(row * 2, row * 2 + 2), 16)
  }
  return rows
}

export function isGlyphPixelSet(rows: Uint8Array, column: number, row: number): boolean {
  return (((rows[row] ?? 0) >> (TILE_SIZE - 1 - column)) & 1) === 1
}

function isEmpty(rows: Uint8Array): boolean {
  return rows.every((row) => row === 0)
}

// Rec. 601 luma, in integers — the CRT weighting these fonts assume.
export function luminanceAt(data: Uint8ClampedArray, offset: number): number {
  return Math.round((data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000)
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(0, value))
}

// `rect`'s own RGBA bytes out of `image`; what `readTextBox`'s cache compares, since two equal
// results here guarantee byte-identical output from every stage downstream.
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
      // Written unconditionally, exactly like `binarise` — a reused `dest` must not keep stale bytes.
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

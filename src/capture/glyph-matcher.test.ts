import { describe, expect, it } from 'vitest'
import { asCaptureProfileId } from '../project/ids.ts'
import type { CaptureProfile, Glyph } from '../project/types.ts'
import { TILE_SIZE } from './capture-profile.ts'
import type { PixelBuffer } from './glyph-matcher.ts'
import {
  binarise,
  forgetGlyph,
  inkThreshold,
  matchGlyph,
  parseGlyphBits,
  readTextBox,
  readTiles,
  sampleNative,
  toGlyphBits,
} from './glyph-matcher.ts'

const SCALE = 7.1875 // deliberately not an integer, near what an emulator window actually produces
const NATIVE_WIDTH = 64
const NATIVE_HEIGHT = 32
const SCREEN_ORIGIN = { x: 13, y: 9 } // console screen sits inside a larger captured window
const FRAME_WIDTH = 480
const FRAME_HEIGHT = 248

const FIELD: Pixel = [232, 236, 248] // SGB palette: off-white/blue-tinted box, blue-black glyphs
const INK: Pixel = [40, 48, 88]

type Pixel = [number, number, number]

const D = bitmap([
  '###.....',
  '#..#....',
  '#...#...',
  '#...#...',
  '#...#...',
  '#..#....',
  '###.....',
  '........',
])

const U = bitmap([
  '#...#...',
  '#...#...',
  '#...#...',
  '#...#...',
  '#...#...',
  '#...#...',
  '.###....',
  '........',
])

const SHARP_S = bitmap([
  '.##.....',
  '#..#....',
  '#..#....',
  '###.....',
  '#..#....',
  '#..#....',
  '###.....',
  '........',
])

const ARROW = bitmap([ // Pokémon's blinking continuation arrow: a tile, not a character
  '........',
  '........',
  '........',
  '#######.',
  '.#####..',
  '..###...',
  '...#....',
  '........',
])

const ALPHABET: Glyph[] = [
  { char: 'D', bits: D },
  { char: 'U', bits: U },
  { char: 'ß', bits: SHARP_S },
  { char: '', bits: ARROW },
]

describe('sampleNative', () => {
  it('recovers the native image through a non-integer scale', () => {
    const native = blankNative()
    drawTile(native, D, 1, 0)
    drawTile(native, ARROW, 6, 3)
    const frame = toFrame(native)

    const sampled = sampleNative(frame, screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)
    const bits = binarise(sampled, inkThreshold(sampled, wholeScreen()))

    expect(Array.from(bits)).toEqual(Array.from(native.ink))
  })

  it('samples the centre of a native pixel, not its edge, where a 7.1875-wide ink pixel would be lost', () => {
    const native = blankNative()
    setPixel(native, 17, 5)
    const frame = toFrame(native)

    const sampled = sampleNative(frame, screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)
    const bits = binarise(sampled, inkThreshold(sampled, wholeScreen()))

    expect(bits[5 * NATIVE_WIDTH + 17]).toBe(1)
    expect(bits[5 * NATIVE_WIDTH + 16]).toBe(0)
    expect(bits[5 * NATIVE_WIDTH + 18]).toBe(0)
  })

  it('reads the same pixels from a crop of the frame, given the crop origin', () => {
    const native = blankNative()
    drawTile(native, D, 1, 0)
    drawTile(native, ARROW, 6, 3)
    const frame = toFrame(native)

    const whole = sampleNative(frame, screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)

    const origin = { x: SCREEN_ORIGIN.x - 5, y: SCREEN_ORIGIN.y - 3 }
    const crop = cropFrame(frame, origin)
    const cropped = sampleNative(crop, screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT, origin)

    expect(Array.from(cropped.data)).toEqual(Array.from(whole.data))
  })

  it('writes into a given destination instead of allocating one', () => {
    const native = blankNative()
    drawTile(native, D, 1, 0)
    const frame = toFrame(native)
    const dest = new Uint8ClampedArray(NATIVE_WIDTH * NATIVE_HEIGHT * 4)

    const sampled = sampleNative(frame, screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT, undefined, dest)

    expect(sampled.data).toBe(dest)
    const withoutDest = sampleNative(frame, screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)
    expect(Array.from(sampled.data)).toEqual(Array.from(withoutDest.data))
  })
})

describe('inkThreshold', () => {
  it('separates an SGB palette without a per-game constant', () => {
    const native = blankNative()
    drawTile(native, D, 1, 1)
    const sampled = sampleNative(toFrame(native), screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)

    const threshold = inkThreshold(sampled, wholeScreen())

    expect(threshold).toBeGreaterThanOrEqual(luminance(INK))
    expect(threshold).toBeLessThan(luminance(FIELD))
  })

  it('finds no ink at all in a uniform region', () => {
    const sampled = sampleNative(toFrame(blankNative()), screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)

    const bits = binarise(sampled, inkThreshold(sampled, wholeScreen()))

    expect(bits.some((bit) => bit === 1)).toBe(false)
  })
})

describe('binarise', () => {
  it('writes into a given destination instead of allocating one', () => {
    const native = blankNative()
    drawTile(native, D, 1, 1)
    const sampled = sampleNative(toFrame(native), screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)
    const threshold = inkThreshold(sampled, wholeScreen())
    const dest = new Uint8Array(NATIVE_WIDTH * NATIVE_HEIGHT)

    const bits = binarise(sampled, threshold, undefined, dest)

    expect(bits).toBe(dest)
    expect(Array.from(bits)).toEqual(Array.from(binarise(sampled, threshold)))
  })

  it('zeroes a reused destination rather than keeping a stale bit from a wider prior call', () => {
    const wide = blankNative()
    drawTile(wide, D, 0, 0)
    const wideSampled = sampleNative(toFrame(wide), screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)
    const dest = new Uint8Array(8 * 8)
    binarise(wideSampled, inkThreshold(wideSampled, { x: 0, y: 0, width: 8, height: 8 }), {
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    }, dest)
    expect(dest.some((bit) => bit === 1)).toBe(true)

    const blank = sampleNative(toFrame(blankNative()), screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)
    const reused = binarise(blank, inkThreshold(blank, { x: 0, y: 0, width: 8, height: 8 }), {
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    }, dest)

    expect(reused).toBe(dest)
    expect(reused.every((bit) => bit === 0)).toBe(true)
  })
})

describe('readTiles', () => {
  it('drops a row the text rect only half covers', () => {
    const native = blankNative()
    drawTile(native, D, 1, 0)
    drawTile(native, U, 1, 1)
    drawTile(native, U, 1, 2)
    const sampled = sampleNative(toFrame(native), screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)
    const bits = binarise(sampled, inkThreshold(sampled, wholeScreen()))

    const grid = readTiles(bits, NATIVE_WIDTH, { x: 0, y: 0, width: 40, height: 20 })

    expect(grid.columns).toBe(5)
    expect(grid.rows).toBe(2)
  })

  it('reads background outside the image rather than throwing', () => {
    const bits = new Uint8Array(NATIVE_WIDTH * NATIVE_HEIGHT)

    const grid = readTiles(bits, NATIVE_WIDTH, { x: 60, y: 28, width: 16, height: 16 })

    expect(grid.columns * grid.rows).toBe(2 * 2)
    expect(grid.cells.every((byte) => byte === 0)).toBe(true)
  })

  it('reuses a destination grid of the same dimensions instead of allocating a new one', () => {
    const bits = new Uint8Array(NATIVE_WIDTH * NATIVE_HEIGHT)
    const rect = { x: 0, y: 0, width: 16, height: 16 }
    const first = readTiles(bits, NATIVE_WIDTH, rect)

    const second = readTiles(bits, NATIVE_WIDTH, rect, first)

    expect(second).toBe(first)
    expect(second.cells).toBe(first.cells)
  })
})

describe('matchGlyph', () => {
  const tile = mustParse(D)

  it('matches an exact bitmap', () => {
    expect(matchGlyph(tile, ALPHABET)?.char).toBe('D')
  })

  it('refuses a bitmap nothing is close to', () => {
    expect(matchGlyph(mustParse('ffffffffffffffff'), ALPHABET)).toBe(null)
  })

  it('refuses a tile one pixel off rather than reading the glyph beside it', () => {
    expect(matchGlyph(flipBits(D, [[4, 2]]), ALPHABET)).toBe(null)
  })

  // Regression: under a four-bit tolerance, an alphabet holding `P`/`e` but not these read
  // "PPOPESSOP!" for "PROFESSOR!" — bitmaps a real Yellow capture produced.
  it('refuses a character close to one it knows instead of reading that one', () => {
    const known: Glyph[] = [
      { char: 'P', bits: 'fc8282fc80808000' },
      { char: 'e', bits: '00003c427e403e00' },
    ]
    const unlearned = { R: 'fc8282fc88848200', F: 'fe8080fc80808000', 'é': '08103c427e403e00' }

    for (const bits of Object.values(unlearned)) {
      expect(matchGlyph(mustParse(bits), known)).toBe(null)
    }
  })

  it('matches a bit-exact tile with a candidate one bit away, as Gen 1\'s own o/c one-pixel gap requires', () => {
    const nearlyD: Glyph = { char: 'O', bits: toGlyphBits(flipBits(D, [[0, 7]])) }

    expect(matchGlyph(tile, [...ALPHABET, nearlyD])?.char).toBe('D')
  })

  it('reads a re-learned bitmap as the character it was taught', () => {
    const relearned: Glyph = { char: 'D', bits: toGlyphBits(flipBits(D, [[0, 7]])) }

    expect(matchGlyph(mustParse(relearned.bits), [...ALPHABET, relearned])?.char).toBe('D')
  })

  it('ignores a bitmap that is not 16 hex characters', () => {
    expect(matchGlyph(tile, [{ char: 'X', bits: 'nonsense' }])).toBe(null)
  })

  it('reads a bitmap written in upper case hex', () => {
    expect(matchGlyph(tile, [{ char: 'D', bits: D.toUpperCase() }])?.char).toBe('D')
  })

  it('skips a malformed bitmap beside a valid one rather than throwing', () => {
    const alphabet: Glyph[] = [{ char: 'X', bits: 'nonsense' }, { char: 'D', bits: D }]

    expect(matchGlyph(tile, alphabet)?.char).toBe('D')
  })

  it('hits after the cached index is replaced by an equal-valued but differently-identified array, as mergeGlyphs always returns', () => {
    expect(matchGlyph(tile, [...ALPHABET])?.char).toBe('D')
    expect(matchGlyph(tile, [...ALPHABET])?.char).toBe('D')

    const grown = [...ALPHABET, { char: 'X', bits: 'ffffffffffffffff' }]
    expect(matchGlyph(mustParse('ffffffffffffffff'), grown)?.char).toBe('X')
  })
})

describe('forgetGlyph', () => {
  it('takes one bitmap out and leaves the rest in their order', () => {
    expect(forgetGlyph([...ALPHABET], U)).toEqual([
      { char: 'D', bits: D },
      { char: 'ß', bits: SHARP_S },
      { char: '', bits: ARROW },
    ])
  })

  it('reaches a tile wrongly marked as not text, which re-learning cannot since it never lands in unknown again', () => {
    const forgotten = forgetGlyph([...ALPHABET], ARROW)
    expect(forgotten.some((glyph) => glyph.bits === ARROW)).toBe(false)
  })

  it('matches a bitmap written in upper case hex, the way matchGlyph does', () => {
    expect(forgetGlyph([...ALPHABET], U.toUpperCase()).map((glyph) => glyph.char)).toEqual([
      'D',
      'ß',
      '',
    ])
  })

  it('hands back the identical array reference when the bitmap is not in the alphabet, so the reducer costs it no undo step', () => {
    const alphabet = [...ALPHABET]
    expect(forgetGlyph(alphabet, '0000000000000000')).toBe(alphabet)
  })

  it('hands back the same array for a bitmap that is not 16 hex characters', () => {
    const alphabet = [...ALPHABET]
    expect(forgetGlyph(alphabet, 'nonsense')).toBe(alphabet)
  })

  it('removes every entry sharing a bitmap, so a hand-edited duplicate cannot survive', () => {
    const doubled: Glyph[] = [...ALPHABET, { char: 'O', bits: U.toUpperCase() }]
    expect(forgetGlyph(doubled, U).map((glyph) => glyph.char)).toEqual(['D', 'ß', ''])
  })
})

describe('readTextBox', () => {
  it('transcribes a known alphabet exactly', () => {
    const native = blankNative()
    write(native, 0, 'DU', { D, U })
    const reading = readTextBox(toFrame(native), profile(), ALPHABET)

    expect(reading).toEqual({ text: 'DU', unknown: [], unreadable: 0 })
  })

  it('joins two lines with one space and drops trailing spaces', () => {
    const native = blankNative()
    write(native, 0, 'DU', { D, U })
    write(native, 1, 'ß', { ß: SHARP_S })
    const reading = readTextBox(toFrame(native), profile(), ALPHABET)

    expect(reading.text).toBe('DU ß')
  })

  it('reads an empty tile as a space and never asks about it', () => {
    const native = blankNative()
    write(native, 0, 'D U', { D, U })
    const reading = readTextBox(toFrame(native), profile(), ALPHABET)

    expect(reading.text).toBe('D U')
    expect(reading.unknown).toEqual([])
  })

  it('drops a glyph whose character is empty', () => {
    const native = blankNative()
    write(native, 0, 'DU', { D, U })
    drawTile(native, ARROW, 4 + TEXT_RECT.x / 8, 1 + TEXT_RECT.y / 8)
    const reading = readTextBox(toFrame(native), profile(), ALPHABET)

    expect(reading.text).toBe('DU')
    expect(reading.unknown).toEqual([])
  })

  it('reports an unrecognised tile with its grid position instead of inventing a character', () => {
    const native = blankNative()
    write(native, 0, 'DUß', { D, U, ß: SHARP_S })
    const reading = readTextBox(toFrame(native), profile(), [
      { char: 'D', bits: D },
      { char: 'U', bits: U },
    ])

    expect(reading.text).toBe('DU')
    expect(reading.unknown).toMatchObject([{ column: 2, row: 0, bits: SHARP_S, context: 'DU▯' }])
  })

  it('asks about a repeated character once, and still counts both tiles for box-settle.ts to read', () => {
    const native = blankNative()
    write(native, 0, 'DUU', { D, U })
    const reading = readTextBox(toFrame(native), profile(), [{ char: 'D', bits: D }])

    expect(reading.unknown.map((tile) => tile.column)).toEqual([1])
    expect(reading.unknown[0].bits).toBe(U)
    expect(reading.unreadable).toBe(2)
  })

  it('transcribes completely once the unknown tiles have been learned', () => {
    const native = blankNative()
    write(native, 0, 'DUß', { D, U, ß: SHARP_S })
    const frame = toFrame(native)
    const partial: Glyph[] = [{ char: 'D', bits: D }, { char: 'U', bits: U }]

    const first = readTextBox(frame, profile(), partial)
    const learned = first.unknown.map((tile) => ({ char: 'ß', bits: tile.bits }))
    const second = readTextBox(frame, profile(), [...partial, ...learned])

    expect(second).toEqual({ text: 'DUß', unknown: [], unreadable: 0 })
  })

  it('reads a text rect flush against the screen\'s top-left corner', () => {
    const native = blankNative()
    drawTile(native, D, 0, 0)
    drawTile(native, U, 1, 0)

    const reading = readTextBox(
      toFrame(native),
      profile({ textRect: { x: 0, y: 0, width: 16, height: 8 } }),
      ALPHABET,
    )

    expect(reading).toEqual({ text: 'DU', unknown: [], unreadable: 0 })
  })

  it('reads a text rect flush against the screen\'s bottom-right edge', () => {
    const native = blankNative()
    drawTile(native, D, NATIVE_WIDTH / TILE_SIZE - 2, NATIVE_HEIGHT / TILE_SIZE - 1)
    drawTile(native, U, NATIVE_WIDTH / TILE_SIZE - 1, NATIVE_HEIGHT / TILE_SIZE - 1)

    const reading = readTextBox(
      toFrame(native),
      profile({
        textRect: {
          x: NATIVE_WIDTH - 16,
          y: NATIVE_HEIGHT - 8,
          width: 16,
          height: 8,
        },
      }),
      ALPHABET,
    )

    expect(reading).toEqual({ text: 'DU', unknown: [], unreadable: 0 })
  })

  it('reads a text rect overhanging the screen edge as background, not a throw', () => {
    const native = blankNative()
    drawTile(native, D, NATIVE_WIDTH / TILE_SIZE - 1, 0)

    const reading = readTextBox(
      toFrame(native),
      profile({ textRect: { x: NATIVE_WIDTH - 8, y: 0, width: 16, height: 8 } }),
      ALPHABET,
    )

    expect(reading).toEqual({ text: 'D', unknown: [], unreadable: 0 }) // 2nd tile off-image reads space, trimmed
  })
})

describe('readTextBox caching', () => {
  it('returns the identical reading object for two identical frames', () => {
    const native = blankNative()
    write(native, 0, 'DU', { D, U })
    const frame = toFrame(native)
    const testProfile = profile({ id: asCaptureProfileId('cache-test-1') })

    const first = readTextBox(frame, testProfile, ALPHABET)
    const second = readTextBox(frame, testProfile, ALPHABET)

    expect(second).toBe(first)
  })

  it('returns a fresh reading once a textRect pixel changes', () => {
    const testProfile = profile({ id: asCaptureProfileId('cache-test-2') })
    const before = blankNative()
    write(before, 0, 'DU', { D, U })
    const first = readTextBox(toFrame(before), testProfile, ALPHABET)

    const after = blankNative()
    write(after, 0, 'UU', { U })
    const second = readTextBox(toFrame(after), testProfile, ALPHABET)

    expect(second).not.toBe(first)
    expect(second.text).toBe('UU')
  })

  it('returns the cached reading when only pixels outside the textRect change', () => {
    const native = blankNative()
    write(native, 0, 'DU', { D, U })
    const testProfile = profile({ id: asCaptureProfileId('cache-test-3') })
    const first = readTextBox(toFrame(native), testProfile, ALPHABET)

    drawTile(native, ARROW, 6, 3) // outside TEXT_RECT (tile columns 1..5, row 1)
    const second = readTextBox(toFrame(native), testProfile, ALPHABET)

    expect(second).toBe(first)
  })

  it('invalidates on a changed glyphs array even when the frame is identical', () => {
    const native = blankNative()
    write(native, 0, 'DU', { D, U })
    const frame = toFrame(native)
    const testProfile = profile({ id: asCaptureProfileId('cache-test-4') })

    const first = readTextBox(frame, testProfile, ALPHABET)
    const second = readTextBox(frame, testProfile, [...ALPHABET])

    expect(second).not.toBe(first)
    expect(second).toEqual(first)
  })

  it('invalidates on a changed profile id even when the frame is identical', () => {
    const native = blankNative()
    write(native, 0, 'DU', { D, U })
    const frame = toFrame(native)

    const first = readTextBox(frame, profile({ id: asCaptureProfileId('cache-test-5a') }), ALPHABET)
    const second = readTextBox(frame, profile({ id: asCaptureProfileId('cache-test-5b') }), ALPHABET)

    expect(second).not.toBe(first)
    expect(second).toEqual(first)
  })

  it('misses on every frame of a batch of distinct frames, as heldUnknownTiles reads them', () => {
    const testProfile = profile({ id: asCaptureProfileId('cache-test-6') })
    const nativeA = blankNative()
    write(nativeA, 0, 'D', { D })
    const nativeB = blankNative()
    write(nativeB, 0, 'U', { U })

    const first = readTextBox(toFrame(nativeA), testProfile, ALPHABET)
    const second = readTextBox(toFrame(nativeB), testProfile, ALPHABET)
    const third = readTextBox(toFrame(nativeA), testProfile, ALPHABET)

    expect(first.text).toBe('D')
    expect(second.text).toBe('U')
    expect(third.text).toBe('D')
  })
})

describe('readTextBox scratch reuse', () => {
  it('reads two different frames through the same scratch set into their own correct transcripts', () => {
    const testProfile = profile({ id: asCaptureProfileId('scratch-test-1') })
    const nativeA = blankNative()
    write(nativeA, 0, 'DU', { D, U })
    const nativeB = blankNative()
    write(nativeB, 0, 'UD', { D, U })

    const first = readTextBox(toFrame(nativeA), testProfile, ALPHABET)
    const second = readTextBox(toFrame(nativeB), testProfile, ALPHABET)

    expect(first.text).toBe('DU')
    expect(second.text).toBe('UD')
  })

  it('keeps an unknown tile\'s own bytes after an unrelated read reuses the scratch buffers', () => {
    const testProfile = profile({ id: asCaptureProfileId('scratch-test-2') })
    const native = blankNative()
    write(native, 0, 'Dß', { D, ß: SHARP_S })
    const first = readTextBox(toFrame(native), testProfile, [{ char: 'D', bits: D }])
    const firstUnknownBits = first.unknown[0]?.bits

    const other = blankNative()
    write(other, 0, 'UU', { U })
    readTextBox(toFrame(other), testProfile, ALPHABET)

    expect(first.unknown[0]?.bits).toBe(firstUnknownBits)
    expect(first.unknown[0]?.bits).toBe(SHARP_S)
  })

  it('reallocates the scratch set for a profile with different native dimensions', () => {
    const small = profile({ id: asCaptureProfileId('scratch-test-3a') })
    const native = blankNative()
    write(native, 0, 'DU', { D, U })
    const smallReading = readTextBox(toFrame(native), small, ALPHABET)
    expect(smallReading.text).toBe('DU')

    const large = profile({
      id: asCaptureProfileId('scratch-test-3b'),
      nativeWidth: NATIVE_WIDTH * 2,
      nativeHeight: NATIVE_HEIGHT * 2,
      screenRect: { x: SCREEN_ORIGIN.x, y: SCREEN_ORIGIN.y, width: NATIVE_WIDTH * SCALE, height: NATIVE_HEIGHT * SCALE },
    })
    expect(() => readTextBox(toFrame(native), large, ALPHABET)).not.toThrow() // dimension mismatch reads as background, not a crash
  })
})

// ---- synthetic frames ----

const TEXT_RECT = { x: 8, y: 8, width: 40, height: 16 }

type NativeImage = { width: number; height: number; ink: Uint8Array }

function profile(overrides: Partial<CaptureProfile> = {}): CaptureProfile {
  return {
    id: asCaptureProfileId('profile-1'),
    name: 'Synthetic',
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    screenRect: screenRect(),
    nativeWidth: NATIVE_WIDTH,
    nativeHeight: NATIVE_HEIGHT,
    textRect: TEXT_RECT,
    ...overrides,
  }
}

function screenRect(): { x: number; y: number; width: number; height: number } {
  return {
    x: SCREEN_ORIGIN.x,
    y: SCREEN_ORIGIN.y,
    width: NATIVE_WIDTH * SCALE,
    height: NATIVE_HEIGHT * SCALE,
  }
}

function wholeScreen(): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 0, width: NATIVE_WIDTH, height: NATIVE_HEIGHT }
}

/** 8 rows of `#` and `.`, as the 16 hex characters a `Glyph` stores. */
function bitmap(rows: string[]): string {
  const packed = new Uint8Array(8)
  rows.forEach((row, y) => {
    for (let x = 0; x < 8; x++) if (row[x] === '#') packed[y] |= 1 << (7 - x)
  })
  return toGlyphBits(packed)
}

function blankNative(): NativeImage {
  return { width: NATIVE_WIDTH, height: NATIVE_HEIGHT, ink: new Uint8Array(NATIVE_WIDTH * NATIVE_HEIGHT) }
}

function setPixel(image: NativeImage, x: number, y: number): void {
  image.ink[y * image.width + x] = 1
}

function mustParse(bits: string): Uint8Array {
  const rows = parseGlyphBits(bits)
  if (rows === null) throw new Error(`Not a bitmap: ${bits}`)
  return rows
}

function drawTile(image: NativeImage, bits: string, column: number, row: number): void {
  const rows = mustParse(bits)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (((rows[y] >> (7 - x)) & 1) === 1) setPixel(image, column * 8 + x, row * 8 + y)
    }
  }
}

/** A space in `text` leaves the corresponding tile untouched. */
function write(image: NativeImage, line: number, text: string, font: Record<string, string>): void {
  Array.from(text).forEach((char, index) => {
    const bits = font[char]
    if (bits === undefined) return
    drawTile(image, bits, TEXT_RECT.x / 8 + index, TEXT_RECT.y / 8 + line)
  })
}

/** The native image nearest-neighbour upscaled by a non-integer factor, as an emulator window hands the capture API. */
function toFrame(image: NativeImage): PixelBuffer {
  const data = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4)
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 0; x < FRAME_WIDTH; x++) {
      const nativeX = Math.floor((x - SCREEN_ORIGIN.x) / SCALE)
      const nativeY = Math.floor((y - SCREEN_ORIGIN.y) / SCALE)
      const inside =
        nativeX >= 0 && nativeX < image.width && nativeY >= 0 && nativeY < image.height
      const isInk = inside && image.ink[nativeY * image.width + nativeX] === 1
      const colour: Pixel = isInk ? INK : inside ? FIELD : [16, 16, 16] // window chrome, not one of the box colours
      const offset = (y * FRAME_WIDTH + x) * 4
      data[offset] = colour[0]
      data[offset + 1] = colour[1]
      data[offset + 2] = colour[2]
      data[offset + 3] = 255
    }
  }
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, data }
}

/** What `grabFrame`'s crop hands `sampleNative` once `origin` is not `{ x: 0, y: 0 }`. */
function cropFrame(frame: PixelBuffer, origin: { x: number; y: number }): PixelBuffer {
  const width = frame.width - origin.x
  const height = frame.height - origin.y
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((y + origin.y) * frame.width + (x + origin.x)) * 4
      const to = (y * width + x) * 4
      data[to] = frame.data[from]
      data[to + 1] = frame.data[from + 1]
      data[to + 2] = frame.data[from + 2]
      data[to + 3] = frame.data[from + 3]
    }
  }
  return { width, height, data }
}

/** A bitmap with individual pixels inverted, as resampling noise would leave them. */
function flipBits(bits: string, pixels: [number, number][]): Uint8Array {
  const rows = mustParse(bits)
  for (const [x, y] of pixels) rows[y] ^= 1 << (7 - x)
  return rows
}

function luminance([red, green, blue]: Pixel): number {
  return Math.round((red * 299 + green * 587 + blue * 114) / 1000)
}

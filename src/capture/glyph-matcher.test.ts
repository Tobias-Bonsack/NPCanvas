import { describe, expect, it } from 'vitest'
import { asCaptureProfileId } from '../project/ids.ts'
import type { CaptureProfile, Glyph } from '../project/types.ts'
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

// Every frame here is built from bitmaps rather than loaded from a screenshot: a fixture image
// could only be checked by eye, while a synthetic one states what the answer has to be.

/** Deliberately not an integer, and not far from what an emulator window actually produces. */
const SCALE = 7.1875
const NATIVE_WIDTH = 64
const NATIVE_HEIGHT = 32
/** The console screen sits somewhere inside a larger captured window, as it does in practice. */
const SCREEN_ORIGIN = { x: 13, y: 9 }
const FRAME_WIDTH = 480
const FRAME_HEIGHT = 248

/** An SGB palette: the box is off-white and blue-tinted, the glyphs blue-black rather than black. */
const FIELD: Pixel = [232, 236, 248]
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

/** Pokémon's blinking continuation arrow: a tile, and not a character. */
const ARROW = bitmap([
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

  it('samples the centre of a native pixel, not its edge', () => {
    // A single ink pixel is 7.1875 frame pixels wide; sampling an edge would land in the field
    // beside it and lose the pixel entirely.
    const native = blankNative()
    setPixel(native, 17, 5)
    const frame = toFrame(native)

    const sampled = sampleNative(frame, screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)
    const bits = binarise(sampled, inkThreshold(sampled, wholeScreen()))

    expect(bits[5 * NATIVE_WIDTH + 17]).toBe(1)
    expect(bits[5 * NATIVE_WIDTH + 16]).toBe(0)
    expect(bits[5 * NATIVE_WIDTH + 18]).toBe(0)
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

describe('readTiles', () => {
  it('drops a row the text rect only half covers', () => {
    const native = blankNative()
    drawTile(native, D, 1, 0)
    drawTile(native, U, 1, 1)
    drawTile(native, U, 1, 2)
    const sampled = sampleNative(toFrame(native), screenRect(), NATIVE_WIDTH, NATIVE_HEIGHT)
    const bits = binarise(sampled, inkThreshold(sampled, wholeScreen()))

    const tiles = readTiles(bits, NATIVE_WIDTH, { x: 0, y: 0, width: 40, height: 20 })

    expect(tiles.length).toBe(5 * 2)
    expect(tiles.at(-1)).toMatchObject({ column: 4, row: 1 })
  })

  it('reads background outside the image rather than throwing', () => {
    const bits = new Uint8Array(NATIVE_WIDTH * NATIVE_HEIGHT)

    const tiles = readTiles(bits, NATIVE_WIDTH, { x: 60, y: 28, width: 16, height: 16 })

    expect(tiles.length).toBe(2 * 2)
    expect(tiles.every((tile) => tile.rows.every((row) => row === 0))).toBe(true)
  })
})

describe('matchGlyph', () => {
  const tile = { column: 0, row: 0, rows: mustParse(D) }

  it('matches an exact bitmap', () => {
    expect(matchGlyph(tile, ALPHABET)?.char).toBe('D')
  })

  it('refuses a bitmap nothing is close to', () => {
    const nothing = { ...tile, rows: mustParse('ffffffffffffffff') }

    expect(matchGlyph(nothing, ALPHABET)).toBe(null)
  })

  it('refuses a tile one pixel off rather than reading the glyph beside it', () => {
    const noisy = { ...tile, rows: flipBits(D, [[4, 2]]) }

    expect(matchGlyph(noisy, ALPHABET)).toBe(null)
  })

  // The bitmaps a Yellow capture actually produced. Under a four-bit tolerance an alphabet holding
  // `P` and `e` but not these read "PPOPESSOP!" for "PROFESSOR!" — the regression this pins.
  it('refuses a character close to one it knows instead of reading that one', () => {
    const known: Glyph[] = [
      { char: 'P', bits: 'fc8282fc80808000' },
      { char: 'e', bits: '00003c427e403e00' },
    ]
    const unlearned = { R: 'fc8282fc88848200', F: 'fe8080fc80808000', 'é': '08103c427e403e00' }

    for (const bits of Object.values(unlearned)) {
      expect(matchGlyph({ column: 0, row: 0, rows: mustParse(bits) }, known)).toBe(null)
    }
  })

  // The Gen 1 font's own `o` and `c` are one pixel apart, and both have to stay readable.
  it('matches a bit-exact tile with a candidate one bit away', () => {
    const nearlyD: Glyph = { char: 'O', bits: toGlyphBits(flipBits(D, [[0, 7]])) }

    expect(matchGlyph(tile, [...ALPHABET, nearlyD])?.char).toBe('D')
  })

  it('reads a re-learned bitmap as the character it was taught', () => {
    const relearned: Glyph = { char: 'D', bits: toGlyphBits(flipBits(D, [[0, 7]])) }

    expect(matchGlyph({ ...tile, rows: mustParse(relearned.bits) }, [...ALPHABET, relearned])?.char).toBe('D')
  })

  it('ignores a bitmap that is not 16 hex characters', () => {
    expect(matchGlyph(tile, [{ char: 'X', bits: 'nonsense' }])).toBe(null)
  })

  it('reads a bitmap written in upper case hex', () => {
    expect(matchGlyph(tile, [{ char: 'D', bits: D.toUpperCase() }])?.char).toBe('D')
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

  it('reaches a tile that was wrongly marked as not text — the case re-learning cannot', () => {
    // Such a glyph matches silently from then on and never lands in `unknown`, so the learner
    // would never ask about it again. Forgetting it is the only way back to being asked.
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

  it('hands back the same array when the bitmap is not in the alphabet', () => {
    const alphabet = [...ALPHABET]
    // Reference equality, not a deep match: it is what lets the reducer tell a removal of nothing
    // from a real one, and cost it no undo step.
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

  it('asks about a repeated character once, and still counts both tiles', () => {
    const native = blankNative()
    write(native, 0, 'DUU', { D, U })
    const reading = readTextBox(toFrame(native), profile(), [{ char: 'D', bits: D }])

    expect(reading.unknown.map((tile) => tile.column)).toEqual([1])
    expect(reading.unknown[0].bits).toBe(U)
    // One question, two tiles: `box-settle.ts` reads the count to tell a box that is still filling
    // in an unnamed character from one that has come to rest.
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

/** One glyph stamped at a tile position on the console screen. */
function drawTile(image: NativeImage, bits: string, column: number, row: number): void {
  const rows = mustParse(bits)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (((rows[y] >> (7 - x)) & 1) === 1) setPixel(image, column * 8 + x, row * 8 + y)
    }
  }
}

/** A line of text inside the text rect, by character, with a space meaning an untouched tile. */
function write(image: NativeImage, line: number, text: string, font: Record<string, string>): void {
  Array.from(text).forEach((char, index) => {
    const bits = font[char]
    if (bits === undefined) return
    drawTile(image, bits, TEXT_RECT.x / 8 + index, TEXT_RECT.y / 8 + line)
  })
}

/**
 * The native image as a captured frame: nearest-neighbour upscaled by a non-integer factor and
 * painted in two palette colours, which is what an emulator window hands the capture API.
 */
function toFrame(image: NativeImage): PixelBuffer {
  const data = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4)
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 0; x < FRAME_WIDTH; x++) {
      const nativeX = Math.floor((x - SCREEN_ORIGIN.x) / SCALE)
      const nativeY = Math.floor((y - SCREEN_ORIGIN.y) / SCALE)
      const inside =
        nativeX >= 0 && nativeX < image.width && nativeY >= 0 && nativeY < image.height
      const isInk = inside && image.ink[nativeY * image.width + nativeX] === 1
      // Outside the screen is the emulator window's own chrome — dark, and deliberately not one
      // of the two box colours, so a screen rect that was off by a pixel would show up as noise.
      const colour: Pixel = isInk ? INK : inside ? FIELD : [16, 16, 16]
      const offset = (y * FRAME_WIDTH + x) * 4
      data[offset] = colour[0]
      data[offset + 1] = colour[1]
      data[offset + 2] = colour[2]
      data[offset + 3] = 255
    }
  }
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, data }
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

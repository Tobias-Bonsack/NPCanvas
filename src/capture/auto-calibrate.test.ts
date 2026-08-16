import { describe, expect, it } from 'vitest'
import {
  MIN_PROMINENCE,
  contentBounds,
  detectScreenRect,
  detectTextRect,
  edgeEnergy,
  fitLattice,
} from './auto-calibrate.ts'
import type { PixelBuffer } from './glyph-matcher.ts'

// Frames are built here rather than loaded: a fixture screenshot could only be checked by eye,
// while a synthetic upscale states what the pitch and the origin have to come back as.

const NATIVE_WIDTH = 64
const NATIVE_HEIGHT = 64
const FRAME_WIDTH = 640
const FRAME_HEIGHT = 520
const ORIGIN = { x: 37, y: 21 }
/** Not an integer, and near what an emulator window actually produces. */
const SCALE = 7.1875

type Pixel = [number, number, number]

const CHROME: Pixel = [32, 32, 36]
const FIELD: Pixel = [248, 248, 232]
const INK: Pixel = [40, 48, 88]

describe('contentBounds', () => {
  it('brackets the console screen inside the window chrome', () => {
    const bounds = contentBounds(frameOf(patterned(), SCALE, SCALE), 24)

    expect(bounds).toEqual({
      x: ORIGIN.x,
      y: ORIGIN.y,
      width: Math.ceil(NATIVE_WIDTH * SCALE),
      height: Math.ceil(NATIVE_HEIGHT * SCALE),
    })
  })

  it('finds nothing in a frame of one colour', () => {
    expect(contentBounds(blankFrame(), 24)).toBe(null)
  })
})

describe('edgeEnergy', () => {
  it('is zero inside an upscaled native pixel and large on its boundary', () => {
    const frame = frameOf(patterned(), SCALE, SCALE)
    const region = { x: ORIGIN.x, y: ORIGIN.y, width: NATIVE_WIDTH * SCALE, height: NATIVE_HEIGHT * SCALE }

    const energy = edgeEnergy(frame, region, 'x')
    // The 8th native boundary, and a column two frame pixels inside the run before it.
    const boundary = Math.round(8 * SCALE)

    expect(energy[boundary]).toBeGreaterThan(0)
    expect(energy[boundary - 2]).toBe(0)
  })
})

describe('fitLattice', () => {
  it('reads the pitch and the phase off a comb', () => {
    const energy = new Float64Array(600)
    for (let k = 0; k < 80; k++) energy[Math.round(3.5 + k * 7.1875)] = 100

    const lattice = fitLattice(energy, 4, 9)

    expect(lattice).not.toBe(null)
    expect(lattice?.pitch).toBeCloseTo(7.1875, 2)
    expect(Math.abs((lattice?.phase ?? 0) - 3.5)).toBeLessThan(0.25)
    expect(lattice?.prominence).toBeGreaterThan(MIN_PROMINENCE)
  })

  it('prefers the true pitch over its own harmonic', () => {
    const energy = new Float64Array(600)
    for (let k = 0; k < 80; k++) energy[Math.round(k * 7.1875)] = 100

    // 3.59 is exactly half the answer, and answers just as strongly without this rule.
    expect(fitLattice(energy, 3, 9)?.pitch).toBeCloseTo(7.1875, 2)
  })

  it('refuses a signal that does not repeat', () => {
    const energy = new Float64Array(600)
    const random = noise(2463534242)
    for (let index = 0; index < energy.length; index++) energy[index] = random() % 100

    expect(fitLattice(energy, 4, 9)?.prominence ?? 0).toBeLessThan(MIN_PROMINENCE)
  })

  it('refuses a flat signal', () => {
    expect(fitLattice(new Float64Array(600), 4, 9)).toBe(null)
  })
})

describe('detectScreenRect', () => {
  it('measures a screen upscaled by a non-integer factor', () => {
    const detected = detectScreenRect(frameOf(patterned(), SCALE, SCALE), NATIVE_WIDTH, NATIVE_HEIGHT)

    expect(detected).not.toBe(null)
    expect(detected?.horizontal.signal).toBe('step')
    expect(detected?.horizontal.lattice.pitch).toBeCloseTo(SCALE, 2)
    expect(detected?.vertical.lattice.pitch).toBeCloseTo(SCALE, 2)
    expect(detected?.screenRect).toEqual({
      x: ORIGIN.x,
      y: ORIGIN.y,
      width: Math.round(NATIVE_WIDTH * SCALE),
      height: Math.round(NATIVE_HEIGHT * SCALE),
    })
  })

  it('measures each axis separately when the window stretches the output', () => {
    const detected = detectScreenRect(frameOf(patterned(), 7.1875, 4.25), NATIVE_WIDTH, NATIVE_HEIGHT)

    expect(detected?.horizontal.lattice.pitch).toBeCloseTo(7.1875, 2)
    expect(detected?.vertical.lattice.pitch).toBeCloseTo(4.25, 2)
  })

  it('is not thrown off by a second window beside the screen', () => {
    const frame = frameOf(patterned(), SCALE, SCALE)
    // A flat panel to the right of the emulator: inside the content bounds, and on no lattice.
    fill(frame, { x: 520, y: 40, width: 100, height: 300 }, [90, 90, 110])

    const detected = detectScreenRect(frame, NATIVE_WIDTH, NATIVE_HEIGHT)

    expect(detected?.screenRect).toEqual({
      x: ORIGIN.x,
      y: ORIGIN.y,
      width: Math.round(NATIVE_WIDTH * SCALE),
      height: Math.round(NATIVE_HEIGHT * SCALE),
    })
  })

  it('places the origin past a title bar the content bounds swallowed', () => {
    const frame = frameOf(patterned(), SCALE, SCALE)
    // The strip an emulator's own window puts above its output — flat, and therefore on no
    // lattice. Anchoring the origin at the content bounds would start the screen four native
    // pixels early, which is the failure this window search exists to prevent.
    fill(frame, { x: ORIGIN.x, y: ORIGIN.y - 15, width: 460, height: 15 }, [70, 70, 80])

    const detected = detectScreenRect(frame, NATIVE_WIDTH, NATIVE_HEIGHT)

    expect(detected?.screenRect.y).toBe(ORIGIN.y)
    expect(detected?.screenRect.x).toBe(ORIGIN.x)
  })

  it('measures a screen the source scaled smoothly, off its curvature', () => {
    const detected = detectScreenRect(smoothFrame(patterned(), SCALE, SCALE), NATIVE_WIDTH, NATIVE_HEIGHT)

    // Interpolation leaves the first difference flat, so this can only have come from `ramp` —
    // and the two combs sit half a native pixel apart, which the origin has to account for.
    expect(detected?.horizontal.signal).toBe('ramp')
    expect(detected?.vertical.signal).toBe('ramp')
    expect(detected?.horizontal.lattice.pitch).toBeCloseTo(SCALE, 2)
    expect(detected?.screenRect).toEqual({
      x: ORIGIN.x,
      y: ORIGIN.y,
      width: Math.round(NATIVE_WIDTH * SCALE),
      height: Math.round(NATIVE_HEIGHT * SCALE),
    })
  })

  it('refuses a frame with no lattice in it', () => {
    const frame = blankFrame()
    const random = noise(2463534242)
    for (let index = 0; index < FRAME_WIDTH * FRAME_HEIGHT; index++) {
      const value = random() % 256
      frame.data[index * 4] = value
      frame.data[index * 4 + 1] = value
      frame.data[index * 4 + 2] = value
    }

    expect(detectScreenRect(frame, NATIVE_WIDTH, NATIVE_HEIGHT)).toBe(null)
  })
})

describe('detectTextRect', () => {
  it('finds the box by its border and stays inside it', () => {
    const rect = detectTextRect(nativeWithTextBox())

    // The border sits on native rows 39 and 63 and columns 7 and 56, so the whole tiles strictly
    // inside it are two rows starting at 40 and six columns starting at 8 — never the border's own.
    expect(rect).toEqual({ x: 8, y: 40, width: 48, height: 16 })
  })

  it('finds nothing in an empty screen', () => {
    const native = nativeOf(() => FIELD)

    expect(detectTextRect(native)).toBe(null)
  })
})

// ---- synthetic frames ----

/**
 * A native image with content on all four edges, so its bounding box is the screen itself.
 *
 * The border is the *bright* colour on purpose: an emulator draws its output against dark window
 * chrome, so the screen's own outline is the strongest edge in the frame — which is what
 * `latticeOrigin` anchors on, and what a border painted almost the colour of the chrome would take
 * away.
 */
function patterned(): (x: number, y: number) => Pixel {
  return (x, y) => {
    const onEdge = x === 0 || y === 0 || x === NATIVE_WIDTH - 1 || y === NATIVE_HEIGHT - 1
    if (onEdge) return FIELD
    // Deliberately busy: every native pixel boundary should be a candidate boundary somewhere.
    return (x * 7 + y * 5) % 3 === 0 ? INK : FIELD
  }
}

function nativeOf(paint: (x: number, y: number) => Pixel): PixelBuffer {
  const data = new Uint8ClampedArray(NATIVE_WIDTH * NATIVE_HEIGHT * 4)
  for (let y = 0; y < NATIVE_HEIGHT; y++) {
    for (let x = 0; x < NATIVE_WIDTH; x++) {
      write(data, (y * NATIVE_WIDTH + x) * 4, paint(x, y))
    }
  }
  return { width: NATIVE_WIDTH, height: NATIVE_HEIGHT, data }
}

/** A Pokémon-shaped box: a drawn border in the lower half, glyph-like ink inside it. */
function nativeWithTextBox(): PixelBuffer {
  const top = 39
  const bottom = NATIVE_HEIGHT - 1
  const left = 7
  const right = 56
  return nativeOf((x, y) => {
    const onBorder =
      ((y === top || y === bottom) && x >= left && x <= right) ||
      ((x === left || x === right) && y >= top && y <= bottom)
    if (onBorder) return INK
    const inside = x > left && x < right && y > top && y < bottom
    // A sparse scatter standing in for text: enough ink to be a line, not enough to be a wall.
    if (inside && x % 4 === 1 && y % 5 === 2) return INK
    return FIELD
  })
}

/** The native image nearest-neighbour upscaled onto window chrome, as a capture delivers it. */
function frameOf(
  paint: (x: number, y: number) => Pixel,
  scaleX: number,
  scaleY: number,
): PixelBuffer {
  const frame = blankFrame()
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 0; x < FRAME_WIDTH; x++) {
      const nativeX = Math.floor((x - ORIGIN.x) / scaleX)
      const nativeY = Math.floor((y - ORIGIN.y) / scaleY)
      if (nativeX < 0 || nativeX >= NATIVE_WIDTH || nativeY < 0 || nativeY >= NATIVE_HEIGHT) continue
      write(frame.data, (y * FRAME_WIDTH + x) * 4, paint(nativeX, nativeY))
    }
  }
  return frame
}

/**
 * The same upscale, interpolated rather than repeated — what a window scaled by the compositor,
 * or by an emulator that filters its output, actually delivers.
 */
function smoothFrame(
  paint: (x: number, y: number) => Pixel,
  scaleX: number,
  scaleY: number,
): PixelBuffer {
  const frame = blankFrame()
  const at = (x: number, y: number): Pixel =>
    paint(clampNative(x, NATIVE_WIDTH), clampNative(y, NATIVE_HEIGHT))
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 0; x < FRAME_WIDTH; x++) {
      const u = (x + 0.5 - ORIGIN.x) / scaleX - 0.5
      const v = (y + 0.5 - ORIGIN.y) / scaleY - 0.5
      if (u < -0.5 || v < -0.5 || u > NATIVE_WIDTH - 0.5 || v > NATIVE_HEIGHT - 0.5) continue
      const left = Math.floor(u)
      const top = Math.floor(v)
      const tx = u - left
      const ty = v - top
      const colour: Pixel = [0, 0, 0]
      for (let channel = 0; channel < 3; channel++) {
        const above =
          at(left, top)[channel] * (1 - tx) + at(left + 1, top)[channel] * tx
        const below =
          at(left, top + 1)[channel] * (1 - tx) + at(left + 1, top + 1)[channel] * tx
        colour[channel] = Math.round(above * (1 - ty) + below * ty)
      }
      write(frame.data, (y * FRAME_WIDTH + x) * 4, colour)
    }
  }
  return frame
}

function clampNative(value: number, bound: number): number {
  return Math.min(bound - 1, Math.max(0, value))
}

/**
 * A repeatable generator with no structure in it — xorshift32, not a linear congruential one.
 *
 * The distinction is the whole point of the frame this feeds: an LCG's low bits cycle with short
 * periods, so a frame painted from them holds a lattice, and a test that expects such a frame to be
 * refused is testing nothing. Measured, this generator's frames score around 1 for prominence at
 * every size, which is what a shuffle of noise should score.
 */
function noise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state >>> 24
  }
}

function blankFrame(): PixelBuffer {
  const data = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4)
  for (let index = 0; index < FRAME_WIDTH * FRAME_HEIGHT; index++) write(data, index * 4, CHROME)
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, data }
}

function fill(frame: PixelBuffer, rect: { x: number; y: number; width: number; height: number }, colour: Pixel): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      write(frame.data, (y * frame.width + x) * 4, colour)
    }
  }
}

function write(data: Uint8ClampedArray, offset: number, [red, green, blue]: Pixel): void {
  data[offset] = red
  data[offset + 1] = green
  data[offset + 2] = blue
  data[offset + 3] = 255
}

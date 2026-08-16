import type { PixelRect } from '../project/types.ts'
import { TILE_SIZE, roundRect, snapInsideTileGrid } from './capture-profile.ts'
import type { PixelBuffer } from './glyph-matcher.ts'
import { binarise, inkThreshold, luminanceAt } from './glyph-matcher.ts'

// Measuring the console screen inside a captured frame, instead of aiming at it.
//
// The screen is a nearest-neighbour upscale of a 160 × 144 image, so the frame repeats every
// native column `pitch` times and the difference between neighbouring columns is zero everywhere
// except on a native-pixel boundary. Those boundaries are a lattice, `x = phase + k · pitch`, and
// a single-frequency DFT over the difference signal reads both numbers off hundreds of boundaries
// at once — a precision two dragged corners cannot reach.
//
// The axes are fitted independently and nothing here assumes square pixels: an emulator window
// that stretches its output is ordinary, and it is the *disagreement* between two axes that has to
// be measurable rather than assumed away.
//
// Pure, like `glyph-matcher.ts`. `CaptureCalibration` decides what to do with a measurement.

/** Which way a lattice runs. Columns are fitted along `x`, rows along `y`. */
export type Axis = 'x' | 'y'

export type Lattice = {
  /** Frame pixels per native pixel along this axis. */
  pitch: number
  /** The first boundary, relative to the start of the region that was fitted, in `[0, pitch)`. */
  phase: number
  /** The share of the edge energy that lies on this lattice, `0..1`. Comparable between frames. */
  confidence: number
}

export type ScreenDetection = {
  screenRect: PixelRect
  horizontal: Lattice
  vertical: Lattice
}

/**
 * How much of the edge energy must sit on the lattice before a measurement is offered at all.
 *
 * A clean upscale scores above 0.8 — the only thing keeping it off 1.0 is that a boundary lands on
 * a whole frame pixel, so it can be half a pixel from where the pitch predicts. Unstructured
 * pixels score around `1/√n`. Half is far below the first and far above the second.
 */
export const MIN_CONFIDENCE = 0.5

/** Chebyshev distance in RGB that still counts as the window's own background. */
const BACKGROUND_TOLERANCE = 24

/** Pitch search: 0.05 px to find the peak, then 0.002 px to place it — 0.3 px over 160 pixels. */
const COARSE_STEP = 0.05
const FINE_STEP = 0.002

/**
 * How close a rival pitch may score before the larger of the two wins.
 *
 * A comb with spacing `p` answers just as strongly at `p / 2` and `p / 3` — they are its own
 * harmonics, not competitors — so the largest near-best pitch is the real one. Without this the
 * search reliably locks onto half the true scale.
 */
const HARMONIC_MARGIN = 0.95

/** The band the true pitch can lie in, as a fraction of `region / native`. */
const MIN_PITCH_SHARE = 0.25
const MAX_PITCH_SHARE = 1.05

/** Below this a lattice is not a lattice — two frame pixels per native pixel is already generous. */
const SMALLEST_PITCH = 2

/** See `latticeOrigin`: an edge peak lands on the ceiling of the boundary that produced it. */
const EDGE_TO_BOUNDARY = 0.5

/** How far the fitted region reaches past the content, so both outer boundaries are in it. */
const EDGE_MARGIN = 1

/**
 * The console screen inside a frame, or `null` when the frame does not hold one.
 *
 * `null` rather than a low-confidence rectangle: a source that smooths as it scales has no lattice
 * to find, and a measurement nobody can trust is worse than no measurement — the user would save
 * it, and the error would only surface as unnameable tiles two steps later.
 */
export function detectScreenRect(
  frame: PixelBuffer,
  nativeWidth: number,
  nativeHeight: number,
): ScreenDetection | null {
  if (nativeWidth < TILE_SIZE || nativeHeight < TILE_SIZE) return null

  const bounds = contentBounds(frame, BACKGROUND_TOLERANCE)
  if (bounds === null) return null

  // A pixel of margin, because the difference at index `i` is the one between `i - 1` and `i`:
  // without it the screen's own first and last boundary fall outside the signal, and the window
  // search cannot tell the true placement from one that starts a native pixel early.
  const region = grow(bounds, EDGE_MARGIN, frame)
  const across = edgeEnergy(frame, region, 'x')
  const down = edgeEnergy(frame, region, 'y')
  const horizontal = fitAxis(across, region.width, nativeWidth)
  const vertical = fitAxis(down, region.height, nativeHeight)
  if (horizontal === null || vertical === null) return null
  if (horizontal.confidence < MIN_CONFIDENCE || vertical.confidence < MIN_CONFIDENCE) return null

  const screenRect = roundRect({
    x: Math.max(0, region.x + latticeOrigin(across, horizontal, nativeWidth)),
    y: Math.max(0, region.y + latticeOrigin(down, vertical, nativeHeight)),
    width: nativeWidth * horizontal.pitch,
    height: nativeHeight * vertical.pitch,
  })
  return { screenRect, horizontal, vertical }
}

/**
 * Everything in the frame that is not the window's own background, as one rectangle.
 *
 * A coarse answer on purpose: it only has to bracket the screen closely enough to pin the pitch
 * search and to say which lattice line the screen starts on. Whatever it includes beyond the
 * screen — a title bar, a second window — the lattice corrects, because the size it produces is
 * `native × pitch` rather than anything this measured.
 */
export function contentBounds(frame: PixelBuffer, tolerance: number): PixelRect | null {
  if (frame.width === 0 || frame.height === 0) return null
  const background = borderColour(frame)

  let left = frame.width
  let right = -1
  let top = frame.height
  let bottom = -1
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const offset = (y * frame.width + x) * 4
      const differs =
        Math.abs(frame.data[offset] - background[0]) > tolerance ||
        Math.abs(frame.data[offset + 1] - background[1]) > tolerance ||
        Math.abs(frame.data[offset + 2] - background[2]) > tolerance
      if (!differs) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < left || bottom < top) return null
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/**
 * How much the frame changes from one row or column to the next, summed across the other axis.
 *
 * Zero inside an upscaled native pixel and large on its boundary, which is the whole signal the
 * lattice is fitted to. Summed rather than averaged: a boundary that only a few rows disagree
 * across is a weaker boundary, and the fit should treat it as one.
 */
export function edgeEnergy(frame: PixelBuffer, region: PixelRect, axis: Axis): Float64Array {
  const bounds = clampRegion(frame, region)
  const length = axis === 'x' ? bounds.width : bounds.height
  const energy = new Float64Array(Math.max(0, length))
  if (energy.length === 0) return energy

  const across = axis === 'x' ? bounds.height : bounds.width
  for (let index = 1; index < length; index++) {
    let sum = 0
    for (let step = 0; step < across; step++) {
      const x = axis === 'x' ? bounds.x + index : bounds.x + step
      const y = axis === 'x' ? bounds.y + step : bounds.y + index
      const here = luminanceAt(frame.data, (y * frame.width + x) * 4)
      const before =
        axis === 'x'
          ? luminanceAt(frame.data, (y * frame.width + x - 1) * 4)
          : luminanceAt(frame.data, ((y - 1) * frame.width + x) * 4)
      sum += Math.abs(here - before)
    }
    energy[index] = sum
  }
  return energy
}

/**
 * The lattice the edge signal repeats on, or `null` when it does not repeat.
 *
 * One frequency of a DFT per candidate pitch: the magnitude says how much of the energy lines up,
 * the argument says where the first boundary is. Dividing by the total energy makes the score a
 * share rather than a brightness, so the same threshold holds for a dim frame and a vivid one.
 */
export function fitLattice(
  energy: Float64Array,
  minPitch: number,
  maxPitch: number,
): Lattice | null {
  let total = 0
  for (const value of energy) total += value
  if (total <= 0) return null

  const low = Math.max(SMALLEST_PITCH, minPitch)
  if (maxPitch < low || energy.length < low * 4) return null

  const coarse = scanPitches(energy, total, low, maxPitch, COARSE_STEP, true)
  if (coarse === null) return null
  return scanPitches(
    energy,
    total,
    Math.max(low, coarse.pitch - COARSE_STEP),
    Math.min(maxPitch, coarse.pitch + COARSE_STEP),
    FINE_STEP,
    false,
  )
}

/**
 * The text box inside an already-sampled native screen, snapped to whole tiles, or `null`.
 *
 * Found by its border rather than by its emptiness: the interior is not empty — it is the text —
 * so what marks the box out is the run of ink that encloses it, wider than any glyph can be. The
 * interior is then verified to be mostly background, which is what rules out a solid block of
 * scenery that happened to have a straight edge.
 */
export function detectTextRect(native: PixelBuffer): PixelRect | null {
  const bits = binarise(
    native,
    inkThreshold(native, { x: 0, y: 0, width: native.width, height: native.height }),
  )
  // The box lives in the lower part of the screen in every game this reads; searching the whole
  // screen would find the status window at the top just as happily.
  const first = Math.floor(native.height / 2)
  const minRun = Math.floor(native.width * 0.6)

  const rows: number[] = []
  for (let y = first; y < native.height; y++) {
    if (longestRun(bits, 1, y * native.width, native.width) >= minRun) rows.push(y)
  }
  if (rows.length < 2) return null
  const top = rows[0]
  const bottom = rows[rows.length - 1]

  const minColumnRun = Math.floor((bottom - top) * 0.6)
  const columns: number[] = []
  for (let x = 0; x < native.width; x++) {
    const run = longestRun(bits, native.width, top * native.width + x, bottom - top + 1)
    if (run >= minColumnRun) columns.push(x)
  }
  if (columns.length < 2) return null

  const interior = {
    x: columns[0] + 1,
    y: top + 1,
    width: columns[columns.length - 1] - columns[0] - 1,
    height: bottom - top - 1,
  }
  if (interior.width <= 0 || interior.height <= 0) return null
  if (backgroundShare(bits, native.width, interior) < 0.6) return null
  return snapInsideTileGrid(interior)
}

/** One axis of `detectScreenRect`: the band the pitch can lie in, then the fit. */
function fitAxis(energy: Float64Array, span: number, native: number): Lattice | null {
  return fitLattice(energy, (span / native) * MIN_PITCH_SHARE, (span / native) * MAX_PITCH_SHARE)
}

/**
 * Which lattice line the screen starts on, relative to the region.
 *
 * The region is only a bracket: a title bar or a letterbox inside it would put its own edge at the
 * start, and anchoring there would place the origin whole native pixels early — the pitch would be
 * right and every tile still wrong. So the screen is found by sliding a window of `native + 1`
 * lattice lines and keeping the position that encloses the most energy. Console content is where
 * the boundaries are; window chrome is flat, and its lines are empty.
 *
 * Ties go to the smallest offset, because the region's own start is the one piece of evidence the
 * lattice cannot supply: a flat screen would otherwise be placed anywhere it fits.
 *
 * Half a pixel comes off the answer. A native pixel that begins at a fractional frame position
 * claims the frame pixel *containing* that position, so every peak sits at the ceiling of the
 * boundary that produced it — half a pixel late on average, and exactly the amount that decides
 * which way `roundRect` goes.
 */
function latticeOrigin(energy: Float64Array, lattice: Lattice, native: number): number {
  const last = Math.max(0, Math.floor((energy.length - native * lattice.pitch) / lattice.pitch))
  let bestLine = 0
  let bestEnergy = -1
  for (let line = 0; line <= last; line++) {
    let sum = 0
    for (let step = 0; step <= native; step++) {
      sum += energyNear(energy, lattice.phase + (line + step) * lattice.pitch)
    }
    if (sum > bestEnergy) {
      bestEnergy = sum
      bestLine = line
    }
  }

  const start = lattice.phase + bestLine * lattice.pitch - EDGE_TO_BOUNDARY
  // The very first line may equally be the one just before the region — the screen can start a
  // fraction of a native pixel earlier than the content that betrayed it.
  return bestLine === 0 && start > lattice.pitch / 2 ? start - lattice.pitch : start
}

/** The energy of one lattice line, allowing a pixel of rounding either side of it. */
function energyNear(energy: Float64Array, position: number): number {
  const centre = Math.round(position)
  let sum = 0
  for (let index = centre - 1; index <= centre + 1; index++) {
    if (index >= 0 && index < energy.length) sum += energy[index]
  }
  return sum
}

function scanPitches(
  energy: Float64Array,
  total: number,
  minPitch: number,
  maxPitch: number,
  step: number,
  preferLargest: boolean,
): Lattice | null {
  const candidates: Lattice[] = []
  let best = 0
  for (let pitch = minPitch; pitch <= maxPitch; pitch += step) {
    const lattice = latticeAt(energy, total, pitch)
    if (lattice.confidence > best) best = lattice.confidence
    candidates.push(lattice)
  }
  if (candidates.length === 0 || best === 0) return null
  if (!preferLargest) {
    return candidates.reduce((winner, candidate) =>
      candidate.confidence > winner.confidence ? candidate : winner,
    )
  }
  const threshold = best * HARMONIC_MARGIN
  return candidates.filter((candidate) => candidate.confidence >= threshold).at(-1) ?? null
}

/** One frequency of a DFT: how much of the energy repeats at `pitch`, and where it starts. */
function latticeAt(energy: Float64Array, total: number, pitch: number): Lattice {
  let real = 0
  let imaginary = 0
  for (let index = 0; index < energy.length; index++) {
    const value = energy[index]
    if (value === 0) continue
    const angle = (2 * Math.PI * index) / pitch
    real += value * Math.cos(angle)
    imaginary += value * Math.sin(angle)
  }
  const phase = (Math.atan2(imaginary, real) * pitch) / (2 * Math.PI)
  return {
    pitch,
    phase: ((phase % pitch) + pitch) % pitch,
    confidence: Math.hypot(real, imaginary) / total,
  }
}

/** The most common colour along the frame's outermost ring — the window's own background. */
function borderColour(frame: PixelBuffer): [number, number, number] {
  const counts = new Map<number, number>()
  const consider = (x: number, y: number): void => {
    const offset = (y * frame.width + x) * 4
    const key = (frame.data[offset] << 16) | (frame.data[offset + 1] << 8) | frame.data[offset + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (let x = 0; x < frame.width; x++) {
    consider(x, 0)
    consider(x, frame.height - 1)
  }
  for (let y = 0; y < frame.height; y++) {
    consider(0, y)
    consider(frame.width - 1, y)
  }

  let winner = 0
  let most = -1
  for (const [key, count] of counts) {
    if (count > most) {
      most = count
      winner = key
    }
  }
  return [(winner >> 16) & 0xff, (winner >> 8) & 0xff, winner & 0xff]
}

/**
 * The longest run of ink along a line of the mask. `stride` 1 walks a row, the row width a column.
 */
function longestRun(bits: Uint8Array, stride: number, start: number, length: number): number {
  let longest = 0
  let run = 0
  for (let step = 0; step < length; step++) {
    const index = start + step * stride
    if (index >= bits.length) break
    if (bits[index] === 1) {
      run++
      if (run > longest) longest = run
    } else {
      run = 0
    }
  }
  return longest
}

function backgroundShare(bits: Uint8Array, width: number, rect: PixelRect): number {
  let background = 0
  let total = 0
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const index = y * width + x
      if (index < 0 || index >= bits.length) continue
      total++
      if (bits[index] === 0) background++
    }
  }
  return total === 0 ? 0 : background / total
}

/** The rectangle widened by `margin` on every side, without leaving the frame. */
function grow(rect: PixelRect, margin: number, frame: PixelBuffer): PixelRect {
  const x = Math.max(0, rect.x - margin)
  const y = Math.max(0, rect.y - margin)
  return {
    x,
    y,
    width: Math.min(frame.width, rect.x + rect.width + margin) - x,
    height: Math.min(frame.height, rect.y + rect.height + margin) - y,
  }
}

function clampRegion(frame: PixelBuffer, region: PixelRect): PixelRect {
  const x = Math.max(0, Math.floor(region.x))
  const y = Math.max(0, Math.floor(region.y))
  const right = Math.min(frame.width, Math.ceil(region.x + region.width))
  const bottom = Math.min(frame.height, Math.ceil(region.y + region.height))
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

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

/**
 * Which signal a lattice was read out of, and therefore what its phase points at.
 *
 * `step` is a nearest-neighbour upscale: the frame jumps at every native-pixel **boundary**, so
 * the first difference is a comb and the phase is a boundary. `ramp` is a smooth one — the frame
 * runs linearly from one native pixel's colour to the next, so the first difference is flat and
 * carries nothing, while the *curvature* spikes at every native-pixel **centre**. The two combs
 * therefore sit half a native pixel apart, which is the whole reason this is recorded rather than
 * inferred later.
 */
export type LatticeSignal = 'step' | 'ramp'

/** One axis, measured. */
export type AxisMeasurement = { lattice: Lattice; signal: LatticeSignal }

export type Lattice = {
  /** Frame pixels per native pixel along this axis. */
  pitch: number
  /** The first boundary, relative to the start of the region that was fitted, in `[0, pitch)`. */
  phase: number
  /** The share of the prepared energy that lies on this lattice. Says which signal is the real one. */
  share: number
  /**
   * How many times better the winning pitch scores than the same energy shuffled scores.
   *
   * A share is not comparable between frames — a short signal has a high noise floor, a busy
   * desktop behind a small console answers weakly at the right pitch, and two strong edges and
   * nothing else answer at *every* pitch. Nor is the peak's height above the band's middle enough:
   * the best of a hundred candidates stands well above the middle even when all hundred are
   * accidents. So the comparison is against the strongest accident the *same numbers* can produce
   * once their order is destroyed. One means the fit found nothing a shuffle could not.
   */
  prominence: number
}

export type ScreenDetection = {
  screenRect: PixelRect
  horizontal: AxisMeasurement
  vertical: AxisMeasurement
}

/**
 * How far the winning pitch must beat a shuffle of its own energy before it is offered at all.
 *
 * Measured, not guessed: a frame of pure noise scores about 1 — by construction, since a shuffle
 * of noise is noise — while a real VisualBoyAdvance window on a 4K desktop and every synthetic
 * upscale here score several times that.
 */
export const MIN_PROMINENCE = 2.5

/** Chebyshev distance in RGB that still counts as the window's own background. */
const BACKGROUND_TOLERANCE = 24

/** Pitch search: 0.05 px to find the peak, then 0.002 px to place it — 0.3 px over 160 pixels. */
const COARSE_STEP = 0.05
const FINE_STEP = 0.002

/** How close a rival pitch may score before the larger of the two wins. See `strongest`. */
const HARMONIC_MARGIN = 0.95

/** Where the energy is capped, as a quantile of itself. See `prepare`. */
const CLIP_QUANTILE = 0.9

/** A shuffle that scores nothing at all would divide by zero; a peak beside it is as good as it gets. */
const PROMINENCE_CAP = 99

/** The band the true pitch can lie in, as a fraction of `region / native`. */
const MIN_PITCH_SHARE = 0.25
const MAX_PITCH_SHARE = 1.05

/** Below this a lattice is not a lattice — two frame pixels per native pixel is already generous. */
const SMALLEST_PITCH = 2

/** See `latticeOrigin`: an edge peak lands on the ceiling of the boundary that produced it. */
const EDGE_TO_BOUNDARY = 0.5

/** How far the fitted region reaches past the content, so both outer boundaries are in it. */
const EDGE_MARGIN = 1

/** How many lines across the axis the energy sum samples. See `axisEnergy`. */
const CROSS_AXIS_SAMPLES = 600

/** The shortest thing `detectTextRect` will call a text box: a border, a line, and a border. */
const MIN_BOX_HEIGHT = TILE_SIZE * 3

/**
 * The console screen inside a frame, or `null` when the frame does not hold one.
 *
 * `null` rather than a rectangle nobody can trust: a frame with no lattice in it at all has none
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
  const horizontal = measureAxis(frame, region, 'x', nativeWidth)
  const vertical = measureAxis(frame, region, 'y', nativeHeight)
  if (horizontal === null || vertical === null) return null

  const screenRect = roundRect({
    x: Math.max(0, region.x + latticeOrigin(horizontal, nativeWidth)),
    y: Math.max(0, region.y + latticeOrigin(vertical, nativeHeight)),
    width: nativeWidth * horizontal.lattice.pitch,
    height: nativeHeight * vertical.lattice.pitch,
  })
  return {
    screenRect,
    horizontal: { lattice: horizontal.lattice, signal: horizontal.signal },
    vertical: { lattice: vertical.lattice, signal: vertical.signal },
  }
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
  return axisEnergy(frame, region, axis, 'step')
}

/**
 * How much the frame *bends* from one row or column to the next, summed across the other axis.
 *
 * What survives a source that scales smoothly. Interpolating between two native pixels makes the
 * frame run in straight lines whose only kinks are the native pixel centres they were drawn
 * between — so the first difference is flat and says nothing, while the second difference is a
 * comb as clean as the one a hard upscale leaves behind.
 */
export function curvatureEnergy(frame: PixelBuffer, region: PixelRect, axis: Axis): Float64Array {
  return axisEnergy(frame, region, axis, 'ramp')
}

/**
 * Both signals, over one axis. The cross-axis sum is sampled rather than exhaustive: a boundary in
 * an upscaled image runs the full height of the screen, so a few hundred lines settle it, and a
 * 4K frame would otherwise cost tens of millions of reads per press of one button.
 */
function axisEnergy(
  frame: PixelBuffer,
  region: PixelRect,
  axis: Axis,
  signal: LatticeSignal,
): Float64Array {
  const bounds = clampRegion(frame, region)
  const length = axis === 'x' ? bounds.width : bounds.height
  const energy = new Float64Array(Math.max(0, length))
  if (energy.length === 0) return energy

  const across = axis === 'x' ? bounds.height : bounds.width
  const stride = Math.max(1, Math.floor(across / CROSS_AXIS_SAMPLES))
  const last = signal === 'step' ? length : length - 1
  for (let index = 1; index < last; index++) {
    let sum = 0
    for (let step = 0; step < across; step += stride) {
      const x = axis === 'x' ? bounds.x + index : bounds.x + step
      const y = axis === 'x' ? bounds.y + step : bounds.y + index
      const stepOffset = axis === 'x' ? 4 : frame.width * 4
      const offset = (y * frame.width + x) * 4
      const here = luminanceAt(frame.data, offset)
      const before = luminanceAt(frame.data, offset - stepOffset)
      sum +=
        signal === 'step'
          ? Math.abs(here - before)
          : Math.abs(luminanceAt(frame.data, offset + stepOffset) - 2 * here + before)
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
  const prepared = prepare(energy)
  let total = 0
  for (const value of prepared) total += value
  if (total <= 0) return null

  const low = Math.max(SMALLEST_PITCH, minPitch)
  if (maxPitch < low || prepared.length < low * 4) return null

  const band = scanPitches(prepared, total, low, maxPitch, COARSE_STEP)
  if (band.length === 0) return null
  const coarse = strongest(band)
  if (coarse === null) return null

  const refined = scanPitches(
    prepared,
    total,
    Math.max(low, coarse.pitch - COARSE_STEP),
    Math.min(maxPitch, coarse.pitch + COARSE_STEP),
    FINE_STEP,
  )
  const best = refined.reduce(
    (winner, candidate) => (candidate.share > winner.share ? candidate : winner),
    coarse,
  )
  return { ...best, prominence: prominenceOf(best.share, prepared, low, maxPitch) }
}

/**
 * The energy as the fit should see it: pedestal removed, spikes capped.
 *
 * Both steps exist because a real frame is not a comb on an empty background. Window chrome and
 * dithered textures raise every index a little, which is a pedestal that adds nothing to any pitch
 * but drowns the share; and the console's own outer edge runs the full height of the screen, so it
 * alone can outweigh every boundary inside it — two such spikes answer at *any* pitch. Subtracting
 * the median and capping at the ninetieth percentile leaves each boundary counting roughly once,
 * which is what makes one pitch win on merit.
 */
function prepare(energy: Float64Array): Float64Array {
  if (energy.length === 0) return energy
  const baseline = median(Array.from(energy))
  const flattened = new Float64Array(energy.length)
  for (let index = 0; index < energy.length; index++) {
    flattened[index] = Math.max(0, energy[index] - baseline)
  }

  const sorted = Array.from(flattened).sort((left, right) => left - right)
  const cap = sorted[Math.floor((sorted.length - 1) * CLIP_QUANTILE)]
  // A comb on an empty background caps at zero — nothing to flatten, and clipping would erase it.
  if (cap <= 0) return flattened
  for (let index = 0; index < flattened.length; index++) {
    flattened[index] = Math.min(flattened[index], cap)
  }
  return flattened
}

/**
 * The real pitch among the band's candidates: the largest of those scoring near the best.
 *
 * A comb with spacing `p` answers just as strongly at `p / 2` and `p / 3` — they are its own
 * harmonics, not competitors — so the largest near-best pitch is the fundamental. Without this the
 * search reliably locks onto half the true scale.
 */
function strongest(band: readonly Lattice[]): Lattice | null {
  let best = 0
  for (const candidate of band) best = Math.max(best, candidate.share)
  if (best <= 0) return null
  return band.filter((candidate) => candidate.share >= best * HARMONIC_MARGIN).at(-1) ?? null
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
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

  // The box is the *lowest* structure on the screen, not the tallest one: a room's wall runs the
  // full width just as convincingly, and taking the topmost full-width line would stretch the box
  // up over the scenery. So the bottom border is the last such line, and the top border is the
  // last one still far enough above it to hold text.
  const bottom = rows[rows.length - 1]
  const top = rows.filter((row) => bottom - row >= MIN_BOX_HEIGHT).at(-1)
  if (top === undefined) return null

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

/**
 * One axis, fitted from whichever signal the source left behind — and the first difference
 * regardless, because the screen's own outer edge is a hard edge whatever the source did to the
 * pixels inside it. See `latticeOrigin`.
 */
type AxisFit = {
  lattice: Lattice
  signal: LatticeSignal
  energy: Float64Array
  edges: Float64Array
}

/**
 * One axis of `detectScreenRect`: both signals, and the stronger one wins.
 *
 * A hard upscale answers on `step` and only weakly on `ramp` — its curvature is a pair of spikes
 * either side of each boundary rather than one. A smooth upscale answers on `ramp` and not at all
 * on `step`. Choosing by score therefore identifies the source as a side effect of measuring it,
 * which is what the half-native-pixel difference between the two combs needs.
 */
function measureAxis(
  frame: PixelBuffer,
  region: PixelRect,
  axis: Axis,
  native: number,
): AxisFit | null {
  const span = axis === 'x' ? region.width : region.height
  const step = edgeEnergy(frame, region, axis)
  const ramp = curvatureEnergy(frame, region, axis)
  const stepFit = fitAxis(step, span, native)
  const rampFit = fitAxis(ramp, span, native)

  // Chosen by share rather than by prominence: the question here is which comb carries the
  // energy, and both signals can be prominent in a band that has no console in it at all.
  const best =
    (stepFit?.share ?? 0) >= (rampFit?.share ?? 0)
      ? { lattice: stepFit, signal: 'step' as const, energy: step }
      : { lattice: rampFit, signal: 'ramp' as const, energy: ramp }
  if (best.lattice === null || best.lattice.prominence < MIN_PROMINENCE) return null
  return { lattice: best.lattice, signal: best.signal, energy: best.energy, edges: step }
}

/** The band the pitch can lie in, then the fit. */
function fitAxis(energy: Float64Array, span: number, native: number): Lattice | null {
  return fitLattice(energy, (span / native) * MIN_PITCH_SHARE, (span / native) * MAX_PITCH_SHARE)
}

/**
 * Which lattice line the screen starts on, relative to the region.
 *
 * The region is only a bracket: a title bar or a letterbox inside it would put its own edge at the
 * start, and anchoring there would place the origin whole native pixels early — the pitch right,
 * every tile still wrong. So the screen is found by sliding a window of exactly `native` pixels
 * along the lattice and asking, at each placement, how strong the frame's own edges are at the two
 * ends of it. That is the decisive signal: an emulator draws its output against window chrome or a
 * black client area, so the screen's border is the largest step in the frame — on a real
 * VisualBoyAdvance capture it beat every rival placement eighteen to one, where the energy *inside*
 * the window separated them by five percent, which is noise.
 *
 * Ties go to the smallest offset, because the region's own start is the one piece of evidence the
 * lattice cannot supply: a screen with no contrast at its border would otherwise be placed anywhere
 * it fits.
 *
 * Half a pixel comes off the answer. A native pixel that begins at a fractional frame position
 * claims the frame pixel *containing* that position, so every peak sits at the ceiling of the
 * boundary that produced it — half a pixel late on average, and exactly the amount that decides
 * which way `roundRect` goes.
 */
function latticeOrigin(fit: AxisFit, native: number): number {
  const { lattice, energy, edges } = fit
  // A boundary peak sits half a pixel late; a centre peak sits half a pixel late *and* half a
  // native pixel past the edge it is being asked about.
  const toEdge = fit.signal === 'step' ? -EDGE_TO_BOUNDARY : EDGE_TO_BOUNDARY - lattice.pitch / 2
  // A boundary comb has one more line than the screen has pixels; a centre comb has one fewer.
  const lines = fit.signal === 'step' ? native + 1 : native
  const span = native * lattice.pitch
  const last = Math.max(0, Math.floor((energy.length - span) / lattice.pitch))

  let bestLine = 0
  let bestScore = -1
  for (let line = 0; line <= last; line++) {
    const start = lattice.phase + line * lattice.pitch + toEdge
    let inside = 0
    for (let step = 0; step < lines; step++) {
      inside += energyNear(energy, lattice.phase + (line + step) * lattice.pitch)
    }
    // The two outer edges decide, and the interior only breaks ties — hence dividing it down to
    // what a single line is worth. Placements a native pixel apart share almost all their
    // interior, so the interior alone separates them by a few percent, which is noise; the
    // screen's outer edge is the largest edge in the whole frame, which is not.
    const score = energyNear(edges, start) + energyNear(edges, start + span) + inside / native
    if (score > bestScore) {
      bestScore = score
      bestLine = line
    }
  }

  const start = lattice.phase + bestLine * lattice.pitch + toEdge
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
): Lattice[] {
  const candidates: Lattice[] = []
  for (let pitch = minPitch; pitch <= maxPitch; pitch += step) {
    candidates.push(latticeAt(energy, total, pitch))
  }
  return candidates
}

/**
 * One frequency of a DFT: how much of the energy repeats at `pitch`, and where it starts.
 *
 * `prominence` is filled in by `fitLattice`, which is the only place that knows what the rest of
 * the band scored.
 */
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
    share: Math.hypot(real, imaginary) / total,
    prominence: 0,
  }
}

/**
 * How many times the winning share beats the best a shuffle of the same energy can manage.
 *
 * The shuffle is the null hypothesis made concrete: same values, same count, same distribution,
 * no order. Seeded from the data's own length so the answer is identical every time it is asked —
 * a pure function that gave two answers would be untestable.
 */
function prominenceOf(share: number, energy: Float64Array, minPitch: number, maxPitch: number): number {
  const shuffled = shuffle(energy)
  let total = 0
  for (const value of shuffled) total += value
  if (total <= 0) return 0
  let best = 0
  for (const candidate of scanPitches(shuffled, total, minPitch, maxPitch, COARSE_STEP)) {
    best = Math.max(best, candidate.share)
  }
  if (best <= 0) return share > 0 ? PROMINENCE_CAP : 0
  return Math.min(PROMINENCE_CAP, share / best)
}

/** Fisher-Yates with a fixed generator: the same array always shuffles the same way. */
function shuffle(energy: Float64Array): Float64Array {
  const out = Float64Array.from(energy)
  let state = (energy.length * 2654435761) >>> 0
  for (let index = out.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const swap = (state >>> 8) % (index + 1)
    const held = out[index]
    out[index] = out[swap]
    out[swap] = held
  }
  return out
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

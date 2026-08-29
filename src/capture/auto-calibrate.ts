import type { PixelRect } from '../project/types.ts'
import { TILE_SIZE, roundRect, snapInsideTileGrid } from './capture-profile.ts'
import type { PixelBuffer } from './glyph-matcher.ts'
import { binarise, inkThreshold, luminanceAt } from './glyph-matcher.ts'

// The screen is a nearest-neighbour upscale of a 160x144 image, so the frame repeats every native
// column `pitch` times and the difference between neighbouring columns is zero except on a
// native-pixel boundary. Those boundaries form a lattice, `x = phase + k * pitch`, and a
// single-frequency DFT over the difference signal reads both numbers off hundreds of boundaries at
// once — a precision two dragged corners can't reach. Axes are fitted independently since nothing
// here assumes square pixels. Pure, like `glyph-matcher.ts`.

// Columns are fitted along `x`, rows along `y`.
type Axis = 'x' | 'y'

// `step` (hard upscale) jumps at every native-pixel boundary, so its first difference is a comb.
// `ramp` (smooth upscale) is flat in the first difference but spikes in curvature at every
// native-pixel centre — half a native pixel away from `step`'s comb, which is why this is recorded
// rather than inferred later.
type LatticeSignal = 'step' | 'ramp'

type AxisMeasurement = { lattice: Lattice; signal: LatticeSignal }

type Lattice = {
  pitch: number
  phase: number
  share: number
  // How many times better the winning pitch scores than the same energy shuffled. A raw share
  // isn't comparable across frames (noise floor and content vary), so this compares against the
  // strongest accident the same numbers can produce with their order destroyed.
  prominence: number
}

type ScreenDetection = {
  screenRect: PixelRect
  horizontal: AxisMeasurement
  vertical: AxisMeasurement
}

// Measured, not guessed: pure noise scores 0.6-1.6 regardless of frame size, while two real
// VisualBoyAdvance captures at 3840x2088 scored 2.1-3.5 across their axes. 1.8 sits in the gap.
export const MIN_PROMINENCE = 1.8

const BACKGROUND_TOLERANCE = 24

// 0.05px to find the peak, then 0.002px to place it — 0.3px over 160 pixels.
const COARSE_STEP = 0.05
const FINE_STEP = 0.002

const HARMONIC_MARGIN = 0.95
const CLIP_QUANTILE = 0.9
const PROMINENCE_CAP = 99
const MIN_PITCH_SHARE = 0.25
const MAX_PITCH_SHARE = 1.05
const SMALLEST_PITCH = 2
const EDGE_TO_BOUNDARY = 0.5
const EDGE_MARGIN = 1
const CROSS_AXIS_SAMPLES = 600
const MIN_BOX_HEIGHT = TILE_SIZE * 3

// `null` rather than a rectangle nobody can trust — a bad guess here would only surface as
// unnameable tiles two steps later.
export function detectScreenRect(
  frame: PixelBuffer,
  nativeWidth: number,
  nativeHeight: number,
): ScreenDetection | null {
  if (nativeWidth < TILE_SIZE || nativeHeight < TILE_SIZE) return null

  const bounds = contentBounds(frame, BACKGROUND_TOLERANCE)
  if (bounds === null) return null

  // A pixel of margin: the difference at index `i` is between `i-1` and `i`, so without it the
  // screen's own first/last boundary would fall outside the signal.
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

// A coarse answer on purpose — it only has to bracket the screen closely enough to pin the pitch
// search; the lattice corrects anything extra (a title bar, a second window) since its output size
// is `native * pitch`, not whatever this measured.
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

// Zero inside an upscaled native pixel, large on its boundary — the signal the lattice fits.
// Summed rather than averaged, so a boundary only a few rows disagree across scores as weaker.
export function edgeEnergy(frame: PixelBuffer, region: PixelRect, axis: Axis): Float64Array {
  return axisEnergy(frame, region, axis, 'step')
}

// What survives a source that scales smoothly: the first difference is flat, but the second is a
// comb as clean as a hard upscale's.
function curvatureEnergy(frame: PixelBuffer, region: PixelRect, axis: Axis): Float64Array {
  return axisEnergy(frame, region, axis, 'ramp')
}

// Sampled across the cross axis rather than exhaustive — a boundary runs the full height of the
// screen, so a few hundred lines settle it, and a 4K frame would otherwise cost tens of millions
// of reads per button press.
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

// One DFT frequency per candidate pitch: magnitude says how much energy lines up, argument says
// where the first boundary is. Dividing by total energy makes the score a share, not a brightness,
// so the same threshold holds for a dim frame and a vivid one.
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

// Pedestal removed, spikes capped: window chrome and dithered textures add a pedestal that drowns
// the share, and the screen's own outer edge can outweigh every boundary inside it. Subtracting
// the median and capping at the 90th percentile leaves each boundary counting roughly once.
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

// The largest of the candidates scoring near the best — a comb with spacing `p` answers just as
// strongly at `p/2` and `p/3` (its own harmonics), so without this the search locks onto half scale.
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

// Found by its border, not its emptiness — the interior is the text, so the box is marked by the
// enclosing run of ink wider than any glyph, then verified mostly background inside (ruling out
// scenery with a straight edge).
export function detectTextRect(native: PixelBuffer): PixelRect | null {
  const bits = binarise(
    native,
    inkThreshold(native, { x: 0, y: 0, width: native.width, height: native.height }),
  )
  // The box lives in the lower part of the screen in every game this reads; the whole screen would
  // also match the status window at the top.
  const first = Math.floor(native.height / 2)
  const minRun = Math.floor(native.width * 0.6)

  const rows: number[] = []
  for (let y = first; y < native.height; y++) {
    if (longestRun(bits, 1, y * native.width, native.width) >= minRun) rows.push(y)
  }
  if (rows.length < 2) return null

  // The box is the *lowest* full-width structure, not the tallest — a room's wall matches too, so
  // the bottom border is the last such line and the top is the last one far enough above it.
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

type AxisFit = {
  lattice: Lattice
  signal: LatticeSignal
  energy: Float64Array
  edges: Float64Array
}

// Both signals are fitted and the stronger wins: a hard upscale answers on `step` and only weakly
// on `ramp`, a smooth one the reverse — so choosing by score identifies the source as a side effect.
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

  // Chosen by share, not prominence — both signals can be prominent in a band with no console at all.
  const best =
    (stepFit?.share ?? 0) >= (rampFit?.share ?? 0)
      ? { lattice: stepFit, signal: 'step' as const, energy: step }
      : { lattice: rampFit, signal: 'ramp' as const, energy: ramp }
  if (best.lattice === null || best.lattice.prominence < MIN_PROMINENCE) return null
  return { lattice: best.lattice, signal: best.signal, energy: best.energy, edges: step }
}

function fitAxis(energy: Float64Array, span: number, native: number): Lattice | null {
  return fitLattice(energy, (span / native) * MIN_PITCH_SHARE, (span / native) * MAX_PITCH_SHARE)
}

// Which lattice line the screen starts on. The region is only a bracket — a title bar inside it
// could anchor the origin whole native pixels early — so this slides a `native`-pixel window along
// the lattice and picks the placement whose two outer edges are strongest: an emulator's screen
// border is the largest step in the frame (on a real capture it beat rivals 18:1, where interior
// energy separated placements by only 5%, i.e. noise). Half a pixel comes off the result, since a
// peak sits at the ceiling of the boundary that produced it.
function latticeOrigin(fit: AxisFit, native: number): number {
  const { lattice, energy, edges } = fit
  const toEdge = fit.signal === 'step' ? -EDGE_TO_BOUNDARY : EDGE_TO_BOUNDARY - lattice.pitch / 2
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
    // Outer edges decide; interior only breaks ties, so it's divided down to one line's worth.
    const score = energyNear(edges, start) + energyNear(edges, start + span) + inside / native
    if (score > bestScore) {
      bestScore = score
      bestLine = line
    }
  }

  const start = lattice.phase + bestLine * lattice.pitch + toEdge
  // The screen can start a fraction of a native pixel earlier than the content that betrayed it.
  return bestLine === 0 && start > lattice.pitch / 2 ? start - lattice.pitch : start
}

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

// `prominence` is filled in by `fitLattice`, the only place that knows the rest of the band's score.
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

// The shuffle is the null hypothesis made concrete: same values, no order. Seeded from the data's
// own length so the same input always gives the same answer.
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

// Fisher-Yates with a fixed generator — the same array always shuffles the same way.
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

// `stride` 1 walks a row, the row width a column.
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

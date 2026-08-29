import type { TextBoxReading } from './glyph-matcher.ts'

// **Stillness is measured on the transcript, not the pixels** — a blinking continuation arrow
// means the box never holds still on pixels, but once learned as a glyph with an empty `char` it
// drops out of the transcript. Unlearned, it's an unnamed tile appearing/disappearing each frame,
// so a box also counts as changed when its unnamed-tile count grows past its own high-water mark.

export type BoxReading =
  | { kind: 'empty' }
  | { kind: 'held'; signature: string; unreadable: number }
  | { kind: 'text'; text: string }

// Never `empty` — an empty box is the gap between two boxes, with nothing in it to act on.
export type SettledBox = Extract<BoxReading, { kind: 'held' } | { kind: 'text' }>

export type SettleState = {
  signature: string | null
  // A high-water mark, not the last reading's count — see the blinking-arrow note above.
  unreadable: number
  repeats: number
  // Makes a settled box settle **once** — without it, a box left on screen would re-emit every tick.
  emitted: boolean
  // `text` outranks `held`: a box whose only unnamed tile is the blinking arrow can be read whole
  // on the frames the arrow is dark, which beats whichever frame happened to complete the count.
  best: SettledBox | null
}

export const NOTHING_SEEN: SettleState = {
  signature: null,
  unreadable: 0,
  repeats: 0,
  emitted: false,
  best: null,
}

// `settled` is non-null on exactly the tick that completes `settleTicks` unchanged readings.
export function nextSettle(
  state: SettleState,
  reading: BoxReading,
  settleTicks: number,
): { state: SettleState; settled: SettledBox | null } {
  // The gap between two boxes is what makes the same sentence said twice in a row two boxes, not one.
  if (reading.kind === 'empty') return { state: NOTHING_SEEN, settled: null }

  const signature = reading.kind === 'text' ? reading.text : reading.signature
  const unreadable = reading.kind === 'text' ? 0 : reading.unreadable

  if (signature !== state.signature || unreadable > state.unreadable) {
    return settleAt(
      { signature, unreadable, repeats: 1, emitted: false, best: reading },
      settleTicks,
    )
  }
  if (state.emitted) return { state, settled: null }
  return settleAt(
    { ...state, repeats: state.repeats + 1, best: moreLegible(state.best, reading) },
    settleTicks,
  )
}

function settleAt(
  state: SettleState,
  settleTicks: number,
): { state: SettleState; settled: SettledBox | null } {
  // A floor of one — `repeats` starts at one, so `settleTicks` tuned to zero would never settle otherwise.
  if (state.repeats < Math.max(1, settleTicks)) return { state, settled: null }
  return { state: { ...state, emitted: true }, settled: state.best }
}

function moreLegible(best: SettledBox | null, reading: SettledBox): SettledBox {
  if (best === null) return reading
  return best.kind === 'text' ? best : reading
}

// Uses `reading.unreadable`, not `unknown.length` — that array is one entry per distinct bitmap, so
// a box typing itself out in an unnamed character would repeat one bitmap and read as unchanged.
export function boxReadingFrom(reading: TextBoxReading): BoxReading {
  if (reading.unknown.length > 0) {
    return { kind: 'held', signature: reading.text, unreadable: reading.unreadable }
  }
  return reading.text === '' ? { kind: 'empty' } : { kind: 'text', text: reading.text }
}

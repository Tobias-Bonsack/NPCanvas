import type { TextBoxReading } from './glyph-matcher.ts'

// When a text box has stopped changing, and is therefore worth reading.
//
// A console types a box out one character at a time, so a loop that wrote every frame it saw would
// log a dozen half-sentences per line. Waiting for the box to hold still is what turns a stream of
// frames back into the discrete thing it represents: one box, read once.
//
// **Stillness is measured on the transcript, not on the pixels.** A text box carries a blinking
// continuation arrow, learned as a glyph with an empty `char` through the learner's "Not text"
// checkbox — so it contributes nothing to `text` while changing pixels several times a second. On
// pixels the box never holds still at all; on its transcript it does, which is why the signature
// below is built out of what the box *says* and never out of what it looks like.
//
// Pure, and its own module for the same reason `append-overlap.ts` is one: the loop is four lines
// and the judgement around it is the rest.

/**
 * One tick's reading of the text box, reduced to what settling cares about.
 *
 * `held` is a box whose transcript is incomplete — `readTextBox` could not name every tile — so it
 * carries a signature rather than a text: it can be recognised as unchanged, but never written.
 */
export type BoxReading =
  | { kind: 'empty' }
  | { kind: 'held'; signature: string }
  | { kind: 'text'; text: string }

/**
 * What the watcher carries between ticks.
 *
 * `emitted` is what makes a settled box settle **once**: without it a box left on screen while the
 * player reads it would be emitted again on every tick after the third.
 */
export type SettleState = {
  signature: string | null
  repeats: number
  emitted: boolean
}

/** Before the first tick, and after every empty box. Shared, so an unchanged state stays identical. */
export const NOTHING_SEEN: SettleState = { signature: null, repeats: 0, emitted: false }

/**
 * The state after one more reading, and the reading to act on when the box has come to rest.
 *
 * `settled` is non-null on exactly the tick that completes `settleTicks` identical readings — a box
 * that stays on screen for another minute yields nothing more, and a box that changes starts over.
 * The returned state is the argument **itself** when nothing moved, so a caller holding it can
 * compare by identity.
 */
export function nextSettle(
  state: SettleState,
  reading: BoxReading,
  settleTicks: number,
): { state: SettleState; settled: BoxReading | null } {
  // An empty box is the gap between two boxes, and that gap is what makes the same sentence said
  // twice in a row two boxes rather than one: the signature has to be forgotten, not superseded.
  if (reading.kind === 'empty') return { state: NOTHING_SEEN, settled: null }

  // Tagged with the kind, so a held box and a plain text can never collide on one string: the two
  // prefixes differ, and every signature carries one.
  const signature =
    reading.kind === 'text' ? `text:${reading.text}` : `held:${reading.signature}`

  if (signature !== state.signature) {
    return settleAt({ signature, repeats: 1, emitted: false }, reading, settleTicks)
  }
  if (state.emitted) return { state, settled: null }
  return settleAt({ signature, repeats: state.repeats + 1, emitted: false }, reading, settleTicks)
}

function settleAt(
  state: SettleState,
  reading: BoxReading,
  settleTicks: number,
): { state: SettleState; settled: BoxReading | null } {
  // A floor of one, so a caller that tuned the constant down to zero settles immediately rather
  // than never — `repeats` starts at one and could never reach a threshold below it.
  if (state.repeats < Math.max(1, settleTicks)) return { state, settled: null }
  return { state: { ...state, emitted: true }, settled: reading }
}

/**
 * What one `readTextBox` result means to the settle loop.
 *
 * A held box's signature carries the tiles it could not name *and* the line each sat in, not only
 * the recognised text: while a box types itself out, a new character that happens to repeat an
 * already-unknown bitmap is dropped by `readTextBox`'s per-bitmap deduplication, and a signature
 * built from `text` and the bitmaps alone would call the growing box unchanged.
 */
export function boxReadingFrom(reading: TextBoxReading): BoxReading {
  if (reading.unknown.length > 0) {
    const tiles = reading.unknown.map(
      (tile) => `${tile.row}:${tile.column}:${tile.bits}:${tile.context}`,
    )
    return { kind: 'held', signature: [reading.text, ...tiles].join(TILE_SEPARATOR) }
  }
  return reading.text === '' ? { kind: 'empty' } : { kind: 'text', text: reading.text }
}

/** Between the transcript and each unnamed tile. Any joiner does: the parts are never taken apart. */
const TILE_SEPARATOR = ' | '

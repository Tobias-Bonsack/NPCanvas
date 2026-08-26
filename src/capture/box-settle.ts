import type { TextBoxReading } from './glyph-matcher.ts'

// When a text box has stopped changing, and is therefore worth reading.
//
// A console types a box out one character at a time, so a loop that wrote every frame it saw would
// log a dozen half-sentences per line. Waiting for the box to hold still is what turns a stream of
// frames back into the discrete thing it represents: one box, read once.
//
// **Stillness is measured on the transcript, not on the pixels.** A text box carries a blinking
// continuation arrow, so on pixels the box never holds still at all. Once the arrow has been
// learned as a glyph with an empty `char` — the learner's "Not text" checkbox — it contributes
// nothing to the transcript, and the transcript is simply constant.
//
// Before it has been learned the arrow is an *unnamed tile*: present on one frame, gone on the
// next, so the box alternates between a reading that can be transcribed and one that cannot. That
// is the first session, where the whole alphabet is still open — so the second rule: **a box has
// changed when it shows something it has not shown before.** A transcript that grew is a change;
// more unnamed tiles at once than the box has shown so far is a change; a tile that merely
// disappeared and came back is not. That covers the arrow without letting a box that is still
// filling settle underneath it — a box typing itself out in characters the alphabet cannot name
// raises its unnamed count even while its transcript stands still.
//
// Pure, and its own module for the same reason `append-overlap.ts` is one: the loop is four lines
// and the judgement around it is the rest.
//
// **A conversation's end is not the same question as a box's stillness, and cannot reuse "empty"
// alone to answer it.** The fixed screen rect a profile reads keeps being read after the last box
// closes — nothing tells this module a dialogue is no longer on screen — and what shows there
// instead (the overworld, a menu, a battle) essentially never binarises to the all-background
// tiles `boxReadingFrom` calls `empty`: real scenery has ink in it. It reads as `held`, and its
// signature is **empty**: scenery has no nameable tile in it, so the only thing that moves poll to
// poll is the count of tiles that could not be named — and that moves both up and down. Change is
// therefore not the tell, and a rule that watched for it counted no gap at all here.
//
// Legibility is the tell. A box genuinely still typing extends what it already showed — each
// poll's signature is the last one plus more — and a box left on screen to be read repeats it,
// which is the same test, since a string is its own prefix. `nextSettle` credits a legible reading
// that continues the one before it and counts a gap tick on everything else, `empty` included.
// That an illegible reading is a gap is the same rule the queue already applies: a box it cannot
// transcribe is one it throws away (`capture-watch.ts`), so what cannot be written must not hold a
// conversation open either. The cost is stated rather than hidden: a real box in an alphabet that
// cannot yet name a single one of its tiles, left standing longer than the threshold, ends a
// conversation — a box that would not have been recorded regardless, and one the learner makes
// legible the moment it is taught.

/**
 * One tick's reading of the text box, reduced to what settling cares about.
 *
 * `held` is a box whose transcript is incomplete — `readTextBox` could not name every tile — so it
 * can be recognised as unchanged, but never written. Its `signature` is only the part that *was*
 * legible, deliberately: that is what makes the arrow blinking on and off one box rather than two.
 */
export type BoxReading =
  | { kind: 'empty' }
  | { kind: 'held'; signature: string; unreadable: number }
  | { kind: 'text'; text: string }

/**
 * A box that has come to rest, and is therefore worth acting on. Never `empty`: an empty box is
 * the gap between two boxes, and there is nothing in it to write or to hold.
 */
export type SettledBox = Extract<BoxReading, { kind: 'held' } | { kind: 'text' }>

/**
 * What the watcher carries between ticks.
 *
 * `unreadable` is a high-water mark rather than the last reading's count — see the blinking arrow
 * above. `emitted` is what makes a settled box settle **once**: without it a box left on screen
 * while the player reads it would be emitted again on every tick after the third.
 */
export type SettleState = {
  /** What the box said, as far as it could be read. `null` before anything was seen. */
  signature: string | null
  /** The most tiles this box has failed to name at once. */
  unreadable: number
  repeats: number
  emitted: boolean
  /**
   * The most legible reading of this box so far — a `text` outranks a `held`, because a box whose
   * only unnamed tile is the blinking arrow can be read whole on the frames the arrow is dark, and
   * that reading is worth more than whichever frame happened to complete the count.
   */
  best: SettledBox | null
  /**
   * Consecutive polls that showed no *progressing* dialogue — what `conversationEnded` is
   * measured against. Kept in state rather than a module variable so `nextSettle` stays pure.
   * Not only literal `empty` readings — see the module comment on why a box that keeps changing
   * without ever extending what it already showed counts the same way.
   */
  gapTicks: number
  /**
   * Whether `conversationEnded` has already fired for the *current* run of gap ticks — the flag
   * that makes it fire once per gap rather than on every subsequent one.
   */
  conversationEndEmitted: boolean
}

/** Before the first tick, and after every empty box. Shared, so an unchanged state stays identical. */
export const NOTHING_SEEN: SettleState = {
  signature: null,
  unreadable: 0,
  repeats: 0,
  emitted: false,
  best: null,
  gapTicks: 0,
  conversationEndEmitted: false,
}

/**
 * The state after one more reading, the box to act on once it has come to rest, and whether this
 * reading is the one that ends a conversation.
 *
 * `settled` is non-null on exactly the tick that completes `settleTicks` readings showing nothing
 * new — a box that stays on screen for another minute yields nothing more, and a box that changes
 * starts over. The returned state is the argument **itself** when nothing moved, so a caller
 * holding it can compare by identity — true for the `settled`/`conversationEnded` fields together,
 * never one without the other.
 *
 * `conversationEnded` is `true` on exactly the tick `gapTicks` reaches `conversationEndTicks` —
 * see the module comment for what counts as a gap tick, and why a threshold rather than the
 * first one. It does not require a box to have been read first: an idle watcher with nothing
 * selected crossing the threshold is harmless, since there is nothing for a caller to close out.
 */
export function nextSettle(
  state: SettleState,
  reading: BoxReading,
  settleTicks: number,
  conversationEndTicks: number,
): { state: SettleState; settled: SettledBox | null; conversationEnded: boolean } {
  // An empty box is the gap between two boxes, and that gap is what makes the same sentence said
  // twice in a row two boxes rather than one: the signature has to be forgotten, not superseded.
  // `gapTicks` is the one thing carried across that forgetting, which is what lets a gap be
  // measured across several polls instead of resetting with everything else.
  if (reading.kind === 'empty') {
    const gap = withGap(state, true, conversationEndTicks)
    return {
      state: { ...NOTHING_SEEN, gapTicks: gap.gapTicks, conversationEndEmitted: gap.conversationEndEmitted },
      settled: null,
      conversationEnded: gap.conversationEnded,
    }
  }

  const signature = reading.kind === 'text' ? reading.text : reading.signature
  const unreadable = reading.kind === 'text' ? 0 : reading.unreadable

  // What holds a conversation open is a reading with dialogue legibly *in* it: a box still typing
  // itself out extends what was already legible on the tick before, and a box left on screen to be
  // read repeats it unchanged — one test covers both, since a repeat is its own prefix. Everything
  // else is a gap tick, `empty` above included. See the module comment for why legibility rather
  // than change is the tell, and why an illegible reading is one this module is entitled to call a
  // gap: it is also a reading the queue throws away.
  const isGap = signature === '' || state.signature === null || !signature.startsWith(state.signature)
  const gap = withGap(state, isGap, conversationEndTicks)

  if (signature !== state.signature || unreadable > state.unreadable) {
    return {
      ...settleAt(
        {
          signature,
          unreadable,
          repeats: 1,
          emitted: false,
          best: reading,
          gapTicks: gap.gapTicks,
          conversationEndEmitted: gap.conversationEndEmitted,
        },
        settleTicks,
      ),
      conversationEnded: gap.conversationEnded,
    }
  }
  if (state.emitted) {
    // The gap still has to be counted here — a settled reading that keeps being handed back is
    // exactly what a motionless screen behind a closed box looks like. The state is returned by
    // identity when the counter did not move, which is the ordinary case: a legible box someone is
    // reading resets it to the zero it already held.
    if (gap.gapTicks === state.gapTicks && gap.conversationEndEmitted === state.conversationEndEmitted) {
      return { state, settled: null, conversationEnded: gap.conversationEnded }
    }
    return {
      state: { ...state, gapTicks: gap.gapTicks, conversationEndEmitted: gap.conversationEndEmitted },
      settled: null,
      conversationEnded: gap.conversationEnded,
    }
  }
  return {
    ...settleAt(
      {
        ...state,
        repeats: state.repeats + 1,
        best: moreLegible(state.best, reading),
        gapTicks: gap.gapTicks,
        conversationEndEmitted: gap.conversationEndEmitted,
      },
      settleTicks,
    ),
    conversationEnded: gap.conversationEnded,
  }
}

/**
 * One more tick's contribution to the gap counter. `isGap` false — a box that settled, stayed
 * stable, or grew the way real typing does — resets it to zero rather than merely holding it,
 * because stability is exactly what a real, ongoing conversation looks like regardless of how
 * long the player takes to read it.
 */
function withGap(
  state: SettleState,
  isGap: boolean,
  conversationEndTicks: number,
): { gapTicks: number; conversationEndEmitted: boolean; conversationEnded: boolean } {
  if (!isGap) return { gapTicks: 0, conversationEndEmitted: false, conversationEnded: false }
  const gapTicks = state.gapTicks + 1
  const crossed = gapTicks >= Math.max(1, conversationEndTicks)
  return {
    gapTicks,
    conversationEndEmitted: state.conversationEndEmitted || crossed,
    conversationEnded: crossed && !state.conversationEndEmitted,
  }
}

function settleAt(
  state: SettleState,
  settleTicks: number,
): { state: SettleState; settled: SettledBox | null } {
  // A floor of one, so a caller that tuned the constant down to zero settles immediately rather
  // than never — `repeats` starts at one and could never reach a threshold below it.
  if (state.repeats < Math.max(1, settleTicks)) return { state, settled: null }
  return { state: { ...state, emitted: true }, settled: state.best }
}

/** A transcribable reading beats one with tiles missing; otherwise the first one seen stands. */
function moreLegible(best: SettledBox | null, reading: SettledBox): SettledBox {
  if (best === null) return reading
  return best.kind === 'text' ? best : reading
}

/**
 * What one `readTextBox` result means to the settle loop.
 *
 * The count of unnamed tiles comes from `readTextBox` rather than from `unknown.length`, because
 * that array holds one entry per distinct *bitmap*: a box typing itself out in a character the
 * alphabet cannot name repeats one bitmap, and counting entries would call the growing box
 * unchanged.
 */
export function boxReadingFrom(reading: TextBoxReading): BoxReading {
  if (reading.unknown.length > 0) {
    return { kind: 'held', signature: reading.text, unreadable: reading.unreadable }
  }
  return reading.text === '' ? { kind: 'empty' } : { kind: 'text', text: reading.text }
}

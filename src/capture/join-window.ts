// How long a fight may still claim the conversation that just ended.
//
// `BATTLE_JOIN_MS` in `capture-watch.ts` is the one number in M15 measured against a single real
// recording rather than derived, and until now nothing reported it. A player who has just finished
// talking to a trainer could not tell whether the fight they were walking into would extend that
// conversation or start its own, and could only find out afterwards by reading what was recorded.
//
// A union rather than a nullable timestamp with a flag beside it, because the two states are
// genuinely different questions: a conversation closed *without* a fight is claimable until a
// deadline, and one closed *out of* a fight waits for the next conversation with no limit at all
// (rule 3 in `capture-watch.ts`). An `until` on the second one would be a number nothing may read.
//
// `now` is an argument for the reason it is one everywhere else in this folder: a function that
// reads the clock itself cannot be tested, and this one is nothing but arithmetic on it.

/** The conversation a fight could still join, and until when. */
export type JoinWindow =
  | { kind: 'timed'; until: number }
  /** Closed out of a fight: the next conversation continues it, however long that takes. */
  | { kind: 'open' }

/**
 * What the status line says about the window, or `null` when there is nothing left to say.
 *
 * Rounded **up** while any of the window is left, so the last fraction of a second reads `1 s`
 * rather than `0 s`: a window showing zero is one that is already closed, and saying so while a
 * fight would still be joined is exactly the wrong way round.
 */
export function describeJoinWindow(window: JoinWindow, now: number): string | null {
  if (window.kind === 'open') return 'the next conversation continues the last one'
  const left = window.until - now
  if (left <= 0) return null
  return `a fight joins the last conversation for ${Math.ceil(left / 1000)} s`
}

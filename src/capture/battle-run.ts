// How long a fight lasts, given only whether a gauge stands right now.
//
// A fight is a *stretch of time*, and the two questions the watcher has to answer about it are both
// about the stretch: has one started, and has it ended. Neither can be read off a single frame,
// because the gauge `battle-gauge.ts` detects is not on screen for the whole fight — it is drawn
// while an opponent stands and for no other reason. It is gone for the box saying the opponent
// fainted, and gone again for the boxes the trainer speaks afterwards:
//
//     picture  1  2  3  4  5  6  7  8  9 10 11
//     gauge    -  -  X  X  X  X  -  X  -  -  -
//
// Read frame by frame, that ends the fight three times and calls the trainer's own words no part of
// it. **The trainer's words fall outside the gauge and inside the fight**, which is exactly the
// distinction this module exists to hold: it keeps a fight alive across an absent gauge until the
// absence has lasted long enough to mean the fight is over.
//
// Pure, and its own module for the reason `box-settle.ts` and `append-overlap.ts` are: the loop is
// four lines and the judgement around it is the rest. `lapseTicks` is an argument rather than a
// constant here, exactly as `settleTicks` and `conversationEndTicks` are to `nextSettle` — the poll
// interval it is measured against belongs to the caller, and so does the tuning.

/**
 * Whether a fight is on, and how long its gauge has been away.
 *
 * `sinceGauge` counts polls, not time: the caller polls at a fixed interval, and a count is what a
 * threshold can be compared against without this module knowing what a millisecond is.
 */
export type BattlePhase = { kind: 'none' } | { kind: 'fighting'; sinceGauge: number }

/** Between fights. Shared, so a phase that did not move stays identical — see `nextBattlePhase`. */
const NO_BATTLE: BattlePhase = { kind: 'none' }

/** A fight seen this very tick. Shared for the same reason: a gauge every poll must not allocate. */
const GAUGE_NOW: BattlePhase = { kind: 'fighting', sinceGauge: 0 }

/**
 * The phase after one more reading, and the two edges a caller acts on.
 *
 * `started` is true on exactly the tick a gauge appears with no fight running, and `lapsed` on
 * exactly the tick the gauge has been absent for `lapseTicks` polls — the same once-per-edge
 * contract `nextSettle`'s `conversationEnded` has, and for the same reason: a caller acts on an
 * edge once, and re-acting every tick for the rest of a fight would retract the same boxes four
 * times a second. `lapsed` cannot fire twice for one fight because the phase it returns is `none`.
 *
 * The returned phase is the argument **itself** when nothing moved, so a caller holding it can
 * compare by identity — the guarantee `nextSettle` makes about its own state.
 */
export function nextBattlePhase(
  phase: BattlePhase,
  gauge: boolean,
  lapseTicks: number,
): { phase: BattlePhase; started: boolean; lapsed: boolean } {
  if (gauge) {
    // A gauge is a fight, whether or not one was already running: mid-fight it only resets the
    // absence, which is what makes one fight a single stretch however often the gauge blinks out.
    const started = phase.kind === 'none'
    const next = phase.kind === 'fighting' && phase.sinceGauge === 0 ? phase : GAUGE_NOW
    return { phase: next, started, lapsed: false }
  }

  if (phase.kind === 'none') return { phase, started: false, lapsed: false }

  const sinceGauge = phase.sinceGauge + 1
  // A floor of one, mirroring `box-settle.ts`: a caller that tunes this to zero lapses immediately
  // rather than never, since the counter starts at one and could not reach a threshold below it.
  if (sinceGauge >= Math.max(1, lapseTicks)) {
    return { phase: NO_BATTLE, started: false, lapsed: true }
  }
  return { phase: { kind: 'fighting', sinceGauge }, started: false, lapsed: false }
}

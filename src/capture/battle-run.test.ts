import { describe, expect, it } from 'vitest'
import type { BattlePhase } from './battle-run.ts'
import { nextBattlePhase } from './battle-run.ts'

const IDLE: BattlePhase = { kind: 'none' }
const LAPSE = 4

/** Walks a run of polls, `X` being a tick the gauge stood on, and reports where the edges fell. */
function walk(polls: string, lapseTicks = LAPSE): { started: number[]; lapsed: number[]; phase: BattlePhase } {
  let phase: BattlePhase = IDLE
  const started: number[] = []
  const lapsed: number[] = []
  for (const [index, poll] of [...polls].entries()) {
    const step = nextBattlePhase(phase, poll === 'X', lapseTicks)
    phase = step.phase
    if (step.started) started.push(index)
    if (step.lapsed) lapsed.push(index)
  }
  return { started, lapsed, phase }
}

describe('nextBattlePhase', () => {
  it('starts on the first gauge and lapses once the gauge has been gone long enough', () => {
    const run = walk('--XXX-----')
    expect(run.started).toEqual([2])
    expect(run.lapsed).toEqual([8])
    expect(run.phase).toEqual({ kind: 'none' })
  })

  it('holds one fight together across a gauge that blinks out', () => {
    // The recorded encounter: the gauge is gone for the box saying the opponent fainted, and back
    // for the box after it. One fight, one start, one lapse.
    const run = walk('XXXX-X----')
    expect(run.started).toEqual([0])
    expect(run.lapsed).toEqual([9])
  })

  it('keeps the trainer’s own words inside the fight', () => {
    // Three boxes after the last gauge, arriving faster than the lapse: still fighting.
    const run = walk('XXX---')
    expect(run.lapsed).toEqual([])
    expect(run.phase).toEqual({ kind: 'fighting', sinceGauge: 3 })
  })

  it('starts again after a lapse, and only then', () => {
    const run = walk('X-----X---')
    expect(run.started).toEqual([0, 6])
    expect(run.lapsed).toEqual([4])
  })

  it('lapses once across a long absence, not on every poll after it', () => {
    const run = walk('X--------------------')
    expect(run.lapsed).toEqual([4])
  })

  it('never starts while no gauge is ever seen', () => {
    const run = walk('----------')
    expect(run.started).toEqual([])
    expect(run.lapsed).toEqual([])
  })

  it('lapses on the very next poll when the threshold is tuned below one', () => {
    expect(walk('X-', 0).lapsed).toEqual([1])
    expect(walk('X-', -3).lapsed).toEqual([1])
  })

  it('returns the phase itself when nothing moved', () => {
    const idle = nextBattlePhase(IDLE, false, LAPSE)
    expect(idle.phase).toBe(IDLE)

    const fighting = nextBattlePhase(IDLE, true, LAPSE).phase
    // A second gauge in a row leaves the count at zero, so the caller sees the same object.
    expect(nextBattlePhase(fighting, true, LAPSE).phase).toBe(fighting)
  })

  it('reports the start before the fight it starts, not after it', () => {
    const step = nextBattlePhase(IDLE, true, LAPSE)
    expect(step).toEqual({ phase: { kind: 'fighting', sinceGauge: 0 }, started: true, lapsed: false })
  })
})

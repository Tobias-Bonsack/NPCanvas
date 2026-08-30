import { describe, expect, it } from 'vitest'
import type { BoxReading, SettledBox, SettleState } from './box-settle.ts'
import { NOTHING_SEEN, boxReadingFrom, nextSettle } from './box-settle.ts'

const SETTLE_TICKS = 3

const HELLO: BoxReading = { kind: 'text', text: 'HELLO' }
const HELLO_THERE: BoxReading = { kind: 'text', text: 'HELLO THERE' }
const EMPTY: BoxReading = { kind: 'empty' }
const HELLO_HELD: BoxReading = { kind: 'held', signature: 'HELLO', unreadable: 1 } // HELLO with one unnamed tile

function feed(
  state: SettleState,
  reading: BoxReading,
  times: number,
): { state: SettleState; settled: SettledBox[] } {
  return feedAll(state, Array.from({ length: times }, () => reading))
}

function feedAll(
  state: SettleState,
  readings: readonly BoxReading[],
): { state: SettleState; settled: SettledBox[] } {
  const settled: SettledBox[] = []
  let current = state
  for (const reading of readings) {
    const step = nextSettle(current, reading, SETTLE_TICKS)
    current = step.state
    if (step.settled !== null) settled.push(step.settled)
  }
  return { state: current, settled }
}

describe('nextSettle', () => {
  it('says nothing while the box is still typing itself out, one more character per frame', () => {
    let state = NOTHING_SEEN
    for (const text of ['H', 'HE', 'HEL', 'HELL', 'HELLO']) {
      const step = nextSettle(state, { kind: 'text', text }, SETTLE_TICKS)
      expect(step.settled).toBeNull()
      state = step.state
    }
    expect(state.repeats).toBe(1)
  })

  it('settles once the same box has been read settleTicks times', () => {
    const { settled } = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS)
    expect(settled).toEqual([HELLO])
  })

  it('settles exactly once however long the box stays on screen', () => {
    const { settled } = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS + 20)
    expect(settled).toEqual([HELLO])
  })

  it('resets repeats and emitted when the transcript changes', () => {
    const settledOnce = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS).state
    expect(settledOnce.emitted).toBe(true)

    const changed = nextSettle(settledOnce, HELLO_THERE, SETTLE_TICKS)
    expect(changed.settled).toBeNull()
    expect(changed.state.repeats).toBe(1)
    expect(changed.state.emitted).toBe(false)
    expect(changed.state.signature).toBe('HELLO THERE')
  })

  it('settles the scrolled box in its turn', () => {
    const first = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS)
    const second = feed(first.state, HELLO_THERE, SETTLE_TICKS)
    expect(second.settled).toEqual([HELLO_THERE])
  })

  it('never settles an empty box, and forgets the transcript that came before it', () => {
    const held = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS - 1).state
    const cleared = nextSettle(held, EMPTY, SETTLE_TICKS)
    expect(cleared.settled).toBeNull()
    expect(cleared.state.signature).toBeNull()
    expect(cleared.state.best).toBeNull()
    expect(cleared.state.emitted).toBe(false)

    const blanked = feed(NOTHING_SEEN, EMPTY, 10)
    expect(blanked.settled).toEqual([])
    expect(blanked.state.signature).toBeNull()
  })

  it('reads the same line again once the box has closed in between, as two NPCs saying the same sentence must', () => {
    const first = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS)
    const gap = nextSettle(first.state, EMPTY, SETTLE_TICKS)
    const again = feed(gap.state, HELLO, SETTLE_TICKS)
    expect(again.settled).toEqual([HELLO])
  })

  it('settles a held box on its own signature', () => {
    const { settled } = feed(NOTHING_SEEN, HELLO_HELD, SETTLE_TICKS + 5)
    expect(settled).toEqual([HELLO_HELD])
  })

  // Alternates held/text like an unlearned continuation arrow blinking; without the high-water
  // rule this would reset the count every tick and the box would never settle.
  it('settles through a blinking tile the alphabet cannot name yet', () => {
    const { settled } = feedAll(NOTHING_SEEN, [
      HELLO_HELD,
      HELLO,
      HELLO_HELD,
      HELLO,
      HELLO_HELD,
      HELLO,
    ])
    expect(settled).toEqual([HELLO]) // written, not held: the arrow-dark frames could be read whole
  })

  it('starts over when a box that could not be read grows another unnamed tile', () => {
    const typing: BoxReading[] = [
      { kind: 'held', signature: 'HELLO', unreadable: 1 },
      { kind: 'held', signature: 'HELLO', unreadable: 2 },
      { kind: 'held', signature: 'HELLO', unreadable: 3 },
    ]
    const { settled, state } = feedAll(NOTHING_SEEN, typing)
    expect(settled).toEqual([])
    expect(state.repeats).toBe(1)
    expect(state.unreadable).toBe(3)
  })

  it('holds a box back when a tile other than the arrow cannot be named', () => {
    const held: BoxReading = { kind: 'held', signature: 'HELL', unreadable: 1 }
    const { settled } = feed(NOTHING_SEEN, held, SETTLE_TICKS)
    expect(settled).toEqual([held])
  })

  it('hands back the same state object while a settled box stays on screen', () => {
    const settled = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS).state
    expect(nextSettle(settled, HELLO, SETTLE_TICKS).state).toBe(settled)
  })

  it('settles immediately when the threshold is below one', () => {
    expect(nextSettle(NOTHING_SEEN, HELLO, 0).settled).toEqual(HELLO)
  })
})

describe('boxReadingFrom', () => {
  it('calls a box with no text and no unknown tiles empty', () => {
    expect(boxReadingFrom({ text: '', unknown: [], unreadable: 0 })).toEqual({ kind: 'empty' })
  })

  it('carries a complete transcript through as text', () => {
    expect(boxReadingFrom({ text: 'HELLO', unknown: [], unreadable: 0 })).toEqual({
      kind: 'text',
      text: 'HELLO',
    })
  })

  it('holds a box back as soon as one tile could not be named', () => {
    const reading = boxReadingFrom({
      text: 'HELLO',
      unknown: [{ column: 5, row: 0, bits: '00ff00ff00ff00ff', context: 'HELLO▯' }],
      unreadable: 1,
    })
    expect(reading).toEqual({ kind: 'held', signature: 'HELLO', unreadable: 1 })
  })

  it('counts every unnamed tile, not every distinct bitmap deduplicated by readTextBox', () => {
    const reading = boxReadingFrom({
      text: '',
      unknown: [{ column: 2, row: 0, bits: '00ff00ff00ff00ff', context: '▯▯▯' }],
      unreadable: 3,
    })
    expect(reading).toEqual({ kind: 'held', signature: '', unreadable: 3 })
  })
})

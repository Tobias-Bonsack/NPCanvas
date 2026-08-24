import { describe, expect, it } from 'vitest'
import type { BoxReading, SettleState } from './box-settle.ts'
import { NOTHING_SEEN, boxReadingFrom, nextSettle } from './box-settle.ts'

const SETTLE_TICKS = 3

const HELLO: BoxReading = { kind: 'text', text: 'HELLO' }
const HELLO_THERE: BoxReading = { kind: 'text', text: 'HELLO THERE' }
const EMPTY: BoxReading = { kind: 'empty' }

/** Feeds one reading `times` times over, and returns every settled reading it produced. */
function feed(
  state: SettleState,
  reading: BoxReading,
  times: number,
): { state: SettleState; settled: BoxReading[] } {
  const settled: BoxReading[] = []
  let current = state
  for (let tick = 0; tick < times; tick++) {
    const step = nextSettle(current, reading, SETTLE_TICKS)
    current = step.state
    if (step.settled !== null) settled.push(step.settled)
  }
  return { state: current, settled }
}

describe('nextSettle', () => {
  it('says nothing while the box is still typing itself out', () => {
    // What a console does: one more character per frame, so every tick is a different signature.
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

  it('resets repeats and emitted when the signature changes', () => {
    const settledOnce = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS).state
    expect(settledOnce.emitted).toBe(true)

    const changed = nextSettle(settledOnce, HELLO_THERE, SETTLE_TICKS)
    expect(changed.settled).toBeNull()
    expect(changed.state).toEqual({ signature: 'text:HELLO THERE', repeats: 1, emitted: false })
  })

  it('settles the scrolled box in its turn', () => {
    const first = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS)
    const second = feed(first.state, HELLO_THERE, SETTLE_TICKS)
    expect(second.settled).toEqual([HELLO_THERE])
  })

  it('never settles an empty box, and forgets what came before it', () => {
    const held = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS - 1).state
    const cleared = nextSettle(held, EMPTY, SETTLE_TICKS)
    expect(cleared.settled).toBeNull()
    expect(cleared.state).toBe(NOTHING_SEEN)

    const blanked = feed(NOTHING_SEEN, EMPTY, 10)
    expect(blanked.settled).toEqual([])
    expect(blanked.state).toBe(NOTHING_SEEN)
  })

  it('reads the same line again once the box has closed in between', () => {
    // Two NPCs saying the same sentence is two lines, and the gap is the only thing that says so.
    const first = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS)
    const gap = nextSettle(first.state, EMPTY, SETTLE_TICKS)
    const again = feed(gap.state, HELLO, SETTLE_TICKS)
    expect(again.settled).toEqual([HELLO])
  })

  it('settles a held box on its own signature', () => {
    const held: BoxReading = { kind: 'held', signature: 'HELLO | 0:4:00ff00ff00ff00ff:HELL' }
    const { settled } = feed(NOTHING_SEEN, held, SETTLE_TICKS + 5)
    expect(settled).toEqual([held])
  })

  it('keeps a held box and a text of the same words apart', () => {
    const settledText = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS).state
    const held = nextSettle(settledText, { kind: 'held', signature: 'HELLO' }, SETTLE_TICKS)
    expect(held.state.repeats).toBe(1)
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
    expect(boxReadingFrom({ text: '', unknown: [] })).toEqual({ kind: 'empty' })
  })

  it('carries a complete transcript through as text', () => {
    expect(boxReadingFrom({ text: 'HELLO', unknown: [] })).toEqual({ kind: 'text', text: 'HELLO' })
  })

  it('holds a box back as soon as one tile could not be named', () => {
    const reading = boxReadingFrom({
      text: 'HELLO',
      unknown: [{ column: 5, row: 0, bits: '00ff00ff00ff00ff', context: 'HELLO▯' }],
    })
    expect(reading.kind).toBe('held')
  })

  it('changes signature when the line grows behind an already-unknown tile', () => {
    // `readTextBox` deduplicates unknown tiles by bitmap, so the second `▯` is dropped from
    // `unknown` — only the context says the box moved on.
    const typing = boxReadingFrom({
      text: 'HELL',
      unknown: [{ column: 4, row: 0, bits: '00ff00ff00ff00ff', context: 'HELL▯' }],
    })
    const grown = boxReadingFrom({
      text: 'HELL',
      unknown: [{ column: 4, row: 0, bits: '00ff00ff00ff00ff', context: 'HELL▯▯' }],
    })
    expect(typing).not.toEqual(grown)
  })
})

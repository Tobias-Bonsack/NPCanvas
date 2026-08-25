import { describe, expect, it } from 'vitest'
import type { BoxReading, SettledBox, SettleState } from './box-settle.ts'
import { NOTHING_SEEN, boxReadingFrom, nextSettle } from './box-settle.ts'

const SETTLE_TICKS = 3
/** Large enough that no ordinary settle test below crosses it by accident. */
const CONVERSATION_END_TICKS = 1000

const HELLO: BoxReading = { kind: 'text', text: 'HELLO' }
const HELLO_THERE: BoxReading = { kind: 'text', text: 'HELLO THERE' }
const EMPTY: BoxReading = { kind: 'empty' }
/** The same box on a frame where one tile could not be named — the arrow, or a new character. */
const HELLO_HELD: BoxReading = { kind: 'held', signature: 'HELLO', unreadable: 1 }

/** Feeds one reading `times` times over, and returns every settled box it produced. */
function feed(
  state: SettleState,
  reading: BoxReading,
  times: number,
  conversationEndTicks = CONVERSATION_END_TICKS,
): { state: SettleState; settled: SettledBox[] } {
  return feedAll(state, Array.from({ length: times }, () => reading), conversationEndTicks)
}

function feedAll(
  state: SettleState,
  readings: readonly BoxReading[],
  conversationEndTicks = CONVERSATION_END_TICKS,
): { state: SettleState; settled: SettledBox[] } {
  const settled: SettledBox[] = []
  let current = state
  for (const reading of readings) {
    const step = nextSettle(current, reading, SETTLE_TICKS, conversationEndTicks)
    current = step.state
    if (step.settled !== null) settled.push(step.settled)
  }
  return { state: current, settled }
}

describe('nextSettle', () => {
  it('says nothing while the box is still typing itself out', () => {
    // What a console does: one more character per frame, so every tick reads a longer transcript.
    let state = NOTHING_SEEN
    for (const text of ['H', 'HE', 'HEL', 'HELL', 'HELLO']) {
      const step = nextSettle(state, { kind: 'text', text }, SETTLE_TICKS, CONVERSATION_END_TICKS)
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

    const changed = nextSettle(settledOnce, HELLO_THERE, SETTLE_TICKS, CONVERSATION_END_TICKS)
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
    const cleared = nextSettle(held, EMPTY, SETTLE_TICKS, CONVERSATION_END_TICKS)
    expect(cleared.settled).toBeNull()
    expect(cleared.state.signature).toBeNull()
    expect(cleared.state.best).toBeNull()
    expect(cleared.state.emitted).toBe(false)

    const blanked = feed(NOTHING_SEEN, EMPTY, 10)
    expect(blanked.settled).toEqual([])
    expect(blanked.state.signature).toBeNull()
  })

  it('reads the same line again once the box has closed in between', () => {
    // Two NPCs saying the same sentence is two lines, and the gap is the only thing that says so.
    const first = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS)
    const gap = nextSettle(first.state, EMPTY, SETTLE_TICKS, CONVERSATION_END_TICKS)
    const again = feed(gap.state, HELLO, SETTLE_TICKS)
    expect(again.settled).toEqual([HELLO])
  })

  it('settles a held box on its own signature', () => {
    const { settled } = feed(NOTHING_SEEN, HELLO_HELD, SETTLE_TICKS + 5)
    expect(settled).toEqual([HELLO_HELD])
  })

  it('settles through a blinking tile the alphabet cannot name yet', () => {
    // The continuation arrow before it has been learned: one frame holds it, the next does not,
    // and the transcript is the same either way. Without the high-water rule this alternation
    // would reset the count on every tick and the box would never settle at all.
    const { settled } = feedAll(NOTHING_SEEN, [
      HELLO_HELD,
      HELLO,
      HELLO_HELD,
      HELLO,
      HELLO_HELD,
      HELLO,
    ])
    // Written rather than held: the frames where the arrow was dark could be read whole.
    expect(settled).toEqual([HELLO])
  })

  it('starts over when a box that could not be read grows another unnamed tile', () => {
    // A box typing itself out in characters the alphabet cannot name: the transcript stands still
    // at what is legible, and only the count says the box is still filling.
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
    expect(nextSettle(settled, HELLO, SETTLE_TICKS, CONVERSATION_END_TICKS).state).toBe(settled)
  })

  it('settles immediately when the threshold is below one', () => {
    expect(nextSettle(NOTHING_SEEN, HELLO, 0, CONVERSATION_END_TICKS).settled).toEqual(HELLO)
  })
})

describe('nextSettle: conversationEnded', () => {
  const END_TICKS = 3

  it('does not end a conversation on a gap shorter than the threshold', () => {
    let state = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS, END_TICKS).state
    for (let i = 0; i < END_TICKS - 1; i++) {
      const step = nextSettle(state, EMPTY, SETTLE_TICKS, END_TICKS)
      expect(step.conversationEnded).toBe(false)
      state = step.state
    }
  })

  it('ends a conversation once the gap reaches the threshold', () => {
    let state = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS, END_TICKS).state
    let ended = false
    for (let i = 0; i < END_TICKS; i++) {
      const step = nextSettle(state, EMPTY, SETTLE_TICKS, END_TICKS)
      state = step.state
      if (step.conversationEnded) ended = true
    }
    expect(ended).toBe(true)
  })

  it('fires conversationEnded exactly once per gap, not on every later empty poll', () => {
    let state = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS, END_TICKS).state
    let firings = 0
    for (let i = 0; i < END_TICKS + 10; i++) {
      const step = nextSettle(state, EMPTY, SETTLE_TICKS, END_TICKS)
      state = step.state
      if (step.conversationEnded) firings += 1
    }
    expect(firings).toBe(1)
  })

  it('gets a fresh chance to end once a new box arrives and closes again', () => {
    let state = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS, END_TICKS).state
    for (let i = 0; i < END_TICKS; i++) {
      state = nextSettle(state, EMPTY, SETTLE_TICKS, END_TICKS).state
    }
    state = feed(state, HELLO_THERE, SETTLE_TICKS, END_TICKS).state

    let firings = 0
    for (let i = 0; i < END_TICKS; i++) {
      const step = nextSettle(state, EMPTY, SETTLE_TICKS, END_TICKS)
      state = step.state
      if (step.conversationEnded) firings += 1
    }
    expect(firings).toBe(1)
  })

  it('ends immediately when the threshold is one tick', () => {
    expect(nextSettle(NOTHING_SEEN, EMPTY, SETTLE_TICKS, 1).conversationEnded).toBe(true)
  })

  // A gap is not always literally `empty`: the fixed rect a profile reads keeps being read once a
  // conversation is over, and what shows there instead — the overworld, a menu — essentially
  // never binarises to all-background tiles. It reads as `held`, changing on every poll. A box
  // still typing itself out also changes on every poll, so the two have to be told apart by
  // *how* they change: real typing only ever extends what it already showed.

  it('does not end a conversation while a box keeps growing, however long that takes', () => {
    // Simulates a box typing itself out slower than the threshold: each poll adds one more
    // character, well past END_TICKS polls, and none of it should ever look like a gap.
    let state = NOTHING_SEEN
    let text = ''
    for (let i = 0; i < END_TICKS + 10; i++) {
      text += 'A'
      const step = nextSettle(state, { kind: 'text', text }, SETTLE_TICKS, END_TICKS)
      expect(step.conversationEnded).toBe(false)
      state = step.state
    }
  })

  it('ends a conversation on sustained noise that never repeats or extends, same as empty', () => {
    // Simulates the overworld showing through the same rect: a different, unrelated reading on
    // every poll — nothing about it grows out of the one before it the way real typing would.
    let state = feed(NOTHING_SEEN, HELLO, SETTLE_TICKS, END_TICKS).state
    let ended = false
    for (let i = 0; i < END_TICKS + 5; i++) {
      const step = nextSettle(
        state,
        { kind: 'held', signature: `NOISE${i}`, unreadable: 40 },
        SETTLE_TICKS,
        END_TICKS,
      )
      state = step.state
      if (step.conversationEnded) ended = true
    }
    expect(ended).toBe(true)
  })

  it('does not end a conversation while a held box merely gains unreadable tiles at a stable signature', () => {
    // The legible prefix stays put — `unreadable` growing alone (a character the alphabet does
    // not know yet, further into the box) is progress too, not noise.
    let state = NOTHING_SEEN
    for (let i = 1; i <= END_TICKS + 5; i++) {
      const step = nextSettle(
        state,
        { kind: 'held', signature: 'HELLO', unreadable: i },
        SETTLE_TICKS,
        END_TICKS,
      )
      expect(step.conversationEnded).toBe(false)
      state = step.state
    }
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

  it('counts every unnamed tile, not every distinct bitmap', () => {
    // `readTextBox` deduplicates `unknown` by bitmap, so a line of three unnamed `e`s is one entry
    // and three tiles — and it is the three that says the box is still filling.
    const reading = boxReadingFrom({
      text: '',
      unknown: [{ column: 2, row: 0, bits: '00ff00ff00ff00ff', context: '▯▯▯' }],
      unreadable: 3,
    })
    expect(reading).toEqual({ kind: 'held', signature: '', unreadable: 3 })
  })
})

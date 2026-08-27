import { describe, expect, it } from 'vitest'
import { describeJoinWindow } from './join-window.ts'

const NOW = 1_000_000

describe('describeJoinWindow', () => {
  it('counts a fresh window down in whole seconds', () => {
    expect(describeJoinWindow({ kind: 'timed', until: NOW + 15_000 }, NOW)).toBe(
      'a fight joins the last conversation for 15 s',
    )
  })

  it('rounds up while any of the window is left', () => {
    // 200 ms is one poll. Reading it as "0 s" would say the window is shut while a fight would
    // still be joined, which is the wrong way round.
    expect(describeJoinWindow({ kind: 'timed', until: NOW + 200 }, NOW)).toBe(
      'a fight joins the last conversation for 1 s',
    )
    expect(describeJoinWindow({ kind: 'timed', until: NOW + 1001 }, NOW)).toBe(
      'a fight joins the last conversation for 2 s',
    )
  })

  it('says nothing once the window is spent', () => {
    expect(describeJoinWindow({ kind: 'timed', until: NOW }, NOW)).toBeNull()
    expect(describeJoinWindow({ kind: 'timed', until: NOW - 5_000 }, NOW)).toBeNull()
  })

  it('treats the exact boundary as closed', () => {
    expect(describeJoinWindow({ kind: 'timed', until: NOW + 1 }, NOW)).toBe(
      'a fight joins the last conversation for 1 s',
    )
    expect(describeJoinWindow({ kind: 'timed', until: NOW }, NOW)).toBeNull()
  })

  it('never counts the unlimited window down', () => {
    expect(describeJoinWindow({ kind: 'open' }, NOW)).toBe(
      'the next conversation continues the last one',
    )
    expect(describeJoinWindow({ kind: 'open' }, NOW + 60 * 60 * 1000)).toBe(
      'the next conversation continues the last one',
    )
  })
})

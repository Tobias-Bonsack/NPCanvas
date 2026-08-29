import { describe, expect, it } from 'vitest'
import { pressedEdges } from './gamepad-edges.ts'

describe('pressedEdges', () => {
  it('fires nothing on the first poll, even for a button already held', () => {
    expect(pressedEdges([], [false, true, false, true])).toEqual([])
  })

  it('fires once when a button transitions from released to pressed', () => {
    expect(pressedEdges([false, false], [false, true])).toEqual([1])
  })

  it('does not fire again while a button stays held across polls', () => {
    const held = [false, true]
    expect(pressedEdges(held, [false, true])).toEqual([])
  })

  it('fires again after a release and a second press', () => {
    const held = [false, true]
    const released = [false, false]
    expect(pressedEdges(held, released)).toEqual([])
    expect(pressedEdges(released, held)).toEqual([1])
  })

  it('reports every button pressed in the same poll, in index order', () => {
    expect(pressedEdges([false, false, false], [true, false, true])).toEqual([0, 2])
  })

  it('treats a button missing from the shorter snapshot as not pressed, not a crash', () => {
    // A pad swapped mid-session for one with more buttons: the new button has no previous entry.
    expect(pressedEdges([false], [false, true])).toEqual([1])
    // ...or fewer buttons: the missing current entry is simply never iterated.
    expect(pressedEdges([false, true], [false])).toEqual([])
  })

  it('fires no edge on the poll after the loop restarts with a button still held', () => {
    // `gamepad-watch.ts` clears its per-pad `previous` on every stop, so the loop's first poll
    // after stopping and starting again — no binding, then a binding added back while the player
    // never let go of the button — sees `previous.length === 0` exactly as a fresh connection does.
    const held = [false, true, false]
    expect(pressedEdges(held, held)).toEqual([])
    const afterRestart: readonly boolean[] = []
    expect(pressedEdges(afterRestart, held)).toEqual([])
  })
})

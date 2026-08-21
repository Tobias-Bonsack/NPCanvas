import { describe, expect, it } from 'vitest'
import { dispatch, getState, subscribe } from './store.ts'

/**
 * The contract every `toBe(state)` assertion in `reducer.test.ts` exists to serve: a reducer
 * that returns its input reference must not wake a single subscriber. Without it those tests
 * pin an equality nothing observes, and a React tree re-renders on every rejected edit.
 *
 * Tested through the real module rather than a fabricated store: it is the module-level
 * singleton the app dispatches into, and a copy would prove nothing about it. The store starts
 * `disconnected`, where every document action is a no-op, so these need no project at all.
 */
describe('dispatch: notifying subscribers', () => {
  it('does not notify when reduce returns the identical state', () => {
    let notified = 0
    const unsubscribe = subscribe(() => {
      notified += 1
    })

    const before = getState()
    dispatch({ kind: 'project/pick-cancelled' })

    expect(getState()).toBe(before)
    expect(notified).toBe(0)
    unsubscribe()
  })

  it('notifies once per state change, and never after unsubscribing', () => {
    let notified = 0
    const unsubscribe = subscribe(() => {
      notified += 1
    })

    dispatch({ kind: 'project/loading', directoryName: 'Harbour' })
    expect(getState()).toEqual({ kind: 'loading', directoryName: 'Harbour' })
    expect(notified).toBe(1)

    // The same action again is the same state by value but a new object, so it notifies: the
    // store compares references and never inspects what changed.
    dispatch({ kind: 'project/loading', directoryName: 'Harbour' })
    expect(notified).toBe(2)

    unsubscribe()
    dispatch({ kind: 'project/loading', directoryName: 'Cliffs' })
    expect(notified).toBe(2)
  })
})

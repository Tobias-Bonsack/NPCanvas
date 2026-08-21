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

/**
 * Autosave's listener dispatches `save/pending` synchronously the moment it sees a document
 * edit, so re-entrancy is not a hypothetical here: it happens on every keystroke that lands.
 */
/**
 * Autosave's listener dispatches `save/pending` synchronously the moment it sees a document
 * edit, so re-entrancy is not a hypothetical here: it happens on every edit that lands.
 *
 * Every listener is unsubscribed in a `finally`, because the store is the app's real singleton
 * and a listener leaked by a failing assertion would run inside every test after it.
 */
describe('dispatch: re-entrancy', () => {
  /** What the store holds, in a form a listener can record and a test can read back. */
  function label(): string {
    const state = getState()
    return state.kind === 'loading' ? `loading:${state.directoryName}` : state.kind
  }

  it('lets a listener that dispatches see a state consistent with what it was told', () => {
    const seen: string[] = []
    const unsubscribes: (() => void)[] = []
    let dispatched = false
    try {
      unsubscribes.push(subscribe(() => seen.push(`first ${label()}`)))
      // The middle one dispatches, as autosave's listener does.
      unsubscribes.push(
        subscribe(() => {
          if (dispatched) return
          dispatched = true
          dispatch({ kind: 'project/loading', directoryName: 'Cliffs' })
        }),
      )
      unsubscribes.push(subscribe(() => seen.push(`last ${label()}`)))

      dispatch({ kind: 'project/loading', directoryName: 'Harbour' })

      // Both listeners saw Harbour in the first pass and Cliffs in the second. Run nested, the
      // one registered after the dispatcher would have seen Cliffs while the one before it saw
      // Harbour — one change, two different answers, in the same pass.
      expect(seen).toEqual([
        'first loading:Harbour',
        'last loading:Harbour',
        'first loading:Cliffs',
        'last loading:Cliffs',
      ])
      expect(label()).toBe('loading:Cliffs')
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  })

  it('notifies every listener exactly once per change, the queued change included', () => {
    let notified = 0
    let dispatched = false
    const unsubscribes: (() => void)[] = []
    try {
      unsubscribes.push(
        subscribe(() => {
          notified += 1
        }),
      )
      unsubscribes.push(
        subscribe(() => {
          if (dispatched) return
          dispatched = true
          dispatch({ kind: 'project/loading', directoryName: 'Cliffs' })
        }),
      )

      dispatch({ kind: 'project/loading', directoryName: 'Harbour' })

      // Two changes, two notifications — not three, and not one nested inside the other.
      expect(notified).toBe(2)
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  })

  it('visits the listeners registered when the pass began, not one added during it', () => {
    const seen: string[] = []
    const unsubscribes: (() => void)[] = []
    try {
      unsubscribes.push(
        subscribe(() => {
          seen.push('joiner')
          if (unsubscribes.length > 1) return
          unsubscribes.push(subscribe(() => seen.push('latecomer')))
        }),
      )

      dispatch({ kind: 'project/loading', directoryName: 'Harbour' })
      expect(seen).toEqual(['joiner'])

      // Subscribed from the next change on, which is the only sane reading of "subscribe".
      dispatch({ kind: 'project/loading', directoryName: 'Cliffs' })
      expect(seen).toEqual(['joiner', 'joiner', 'latecomer'])
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  })
})

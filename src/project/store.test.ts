import { describe, expect, it } from 'vitest'
import { dispatch, getState, subscribe } from './store.ts'

// Pins the contract every `toBe(state)` assertion in reducer.test.ts relies on: a reducer returning
// its input reference must not wake a subscriber. Tested against the real module-level store,
// which starts `disconnected` (every document action a no-op), so no project setup is needed.
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

    // Same action again: equal by value, new object, so it notifies (reference compare only).
    dispatch({ kind: 'project/loading', directoryName: 'Harbour' })
    expect(notified).toBe(2)

    unsubscribe()
    dispatch({ kind: 'project/loading', directoryName: 'Cliffs' })
    expect(notified).toBe(2)
  })
})

// Re-entrancy is not hypothetical: autosave's listener dispatches `save/pending` synchronously on
// every edit. Listeners unsubscribe in `finally` since the store is the app's real singleton.
describe('dispatch: re-entrancy', () => {
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
      unsubscribes.push(
        subscribe(() => {
          if (dispatched) return
          dispatched = true
          dispatch({ kind: 'project/loading', directoryName: 'Cliffs' })
        }),
      )
      unsubscribes.push(subscribe(() => seen.push(`last ${label()}`)))

      dispatch({ kind: 'project/loading', directoryName: 'Harbour' })

      // Nested, "last" would see Cliffs while "first" saw Harbour — two answers in one pass.
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

      dispatch({ kind: 'project/loading', directoryName: 'Cliffs' })
      expect(seen).toEqual(['joiner', 'joiner', 'latecomer'])
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  })
})

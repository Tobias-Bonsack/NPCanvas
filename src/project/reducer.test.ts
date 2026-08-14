import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './data-file.ts'
import { asDialogueId, asZoneId } from './ids.ts'
import type { Action } from './reducer.ts'
import { reduce } from './reducer.ts'
import type { AppState } from './types.ts'

type ReadyState = Extract<AppState, { kind: 'ready' }>

function ready(): ReadyState {
  const project = createEmptyProject('Harbour')
  return {
    kind: 'ready',
    directoryName: 'Harbour',
    project,
    save: { kind: 'saved', at: project.savedAt },
    selection: { kind: 'none' },
  }
}

const NON_READY_STATES: readonly AppState[] = [
  { kind: 'unsupported' },
  { kind: 'disconnected' },
  { kind: 'reconnecting', directoryName: 'Harbour' },
  { kind: 'loading', directoryName: 'Harbour' },
  { kind: 'load-failed', directoryName: 'Harbour', message: 'boom' },
]

/** Only meaningful inside `ready`; everywhere else they must be ignored, never throw. */
const READY_SCOPED_ACTIONS: readonly Action[] = [
  { kind: 'save/pending' },
  { kind: 'save/saving' },
  { kind: 'save/saved', at: '2026-08-14T10:00:00.000Z' },
  { kind: 'save/failed', message: 'disk full' },
  { kind: 'selection/set', selection: { kind: 'dialogue', id: asDialogueId('dialogue-1') } },
]

describe('reduce: connection actions', () => {
  it('moves to unsupported', () => {
    expect(reduce({ kind: 'disconnected' }, { kind: 'project/unsupported' })).toEqual({
      kind: 'unsupported',
    })
  })

  it('moves to disconnected', () => {
    expect(reduce({ kind: 'unsupported' }, { kind: 'project/disconnected' })).toEqual({
      kind: 'disconnected',
    })
  })

  it('moves to reconnecting with the directory name', () => {
    expect(
      reduce({ kind: 'disconnected' }, { kind: 'project/reconnecting', directoryName: 'Harbour' }),
    ).toEqual({ kind: 'reconnecting', directoryName: 'Harbour' })
  })

  it('moves to loading with the directory name', () => {
    expect(
      reduce({ kind: 'disconnected' }, { kind: 'project/loading', directoryName: 'Harbour' }),
    ).toEqual({ kind: 'loading', directoryName: 'Harbour' })
  })

  it('moves to load-failed with the message', () => {
    expect(
      reduce(
        { kind: 'loading', directoryName: 'Harbour' },
        { kind: 'project/load-failed', directoryName: 'Harbour', message: 'boom' },
      ),
    ).toEqual({ kind: 'load-failed', directoryName: 'Harbour', message: 'boom' })
  })

  it('lands in ready with a clean save state and no selection', () => {
    const project = createEmptyProject('Harbour')
    const next = reduce(
      { kind: 'loading', directoryName: 'Harbour' },
      { kind: 'project/loaded', directoryName: 'Harbour', project },
    )
    expect(next).toEqual({
      kind: 'ready',
      directoryName: 'Harbour',
      project,
      save: { kind: 'saved', at: project.savedAt },
      selection: { kind: 'none' },
    })
  })

  it('replaces the project on a reload rather than merging into the old one', () => {
    const reloaded = createEmptyProject('Harbour')
    const next = reduce(ready(), {
      kind: 'project/loaded',
      directoryName: 'Harbour',
      project: reloaded,
    })
    expect(next.kind === 'ready' && next.project).toBe(reloaded)
  })
})

describe('reduce: save actions', () => {
  it('walks pending, saving, saved', () => {
    const pending = reduce(ready(), { kind: 'save/pending' })
    expect(pending.kind === 'ready' && pending.save).toEqual({ kind: 'pending' })

    const saving = reduce(pending, { kind: 'save/saving' })
    expect(saving.kind === 'ready' && saving.save).toEqual({ kind: 'saving' })

    const saved = reduce(saving, { kind: 'save/saved', at: '2026-08-14T10:00:00.000Z' })
    expect(saved.kind === 'ready' && saved.save).toEqual({
      kind: 'saved',
      at: '2026-08-14T10:00:00.000Z',
    })
  })

  it('records a failure message', () => {
    const failed = reduce(ready(), { kind: 'save/failed', message: 'disk full' })
    expect(failed.kind === 'ready' && failed.save).toEqual({ kind: 'failed', message: 'disk full' })
  })

  it('keeps the project reference across a save transition', () => {
    const state = ready()
    const next = reduce(state, { kind: 'save/pending' })
    expect(next.kind === 'ready' && next.project).toBe(state.project)
  })
})

describe('reduce: selection actions', () => {
  it('sets and clears the selection', () => {
    const id = asZoneId('zone-1')
    const selected = reduce(ready(), { kind: 'selection/set', selection: { kind: 'zone', id } })
    expect(selected.kind === 'ready' && selected.selection).toEqual({ kind: 'zone', id })

    const cleared = reduce(selected, { kind: 'selection/set', selection: { kind: 'none' } })
    expect(cleared.kind === 'ready' && cleared.selection).toEqual({ kind: 'none' })
  })
})

// The store skips notifying subscribers when `reduce` returns the same reference, so
// reference identity — not deep equality — is the contract being asserted here.
describe('reduce: no-ops return the identical state reference', () => {
  it('for a connection action that changes nothing', () => {
    const unsupported: AppState = { kind: 'unsupported' }
    expect(reduce(unsupported, { kind: 'project/unsupported' })).toBe(unsupported)

    const disconnected: AppState = { kind: 'disconnected' }
    expect(reduce(disconnected, { kind: 'project/disconnected' })).toBe(disconnected)
  })

  it('for a save action that restates the current save state', () => {
    const state = ready()
    expect(reduce(state, { kind: 'save/saved', at: state.project.savedAt })).toBe(state)

    const failed = reduce(state, { kind: 'save/failed', message: 'disk full' })
    expect(reduce(failed, { kind: 'save/failed', message: 'disk full' })).toBe(failed)
  })

  it('for a selection action that restates the current selection', () => {
    const state = ready()
    expect(reduce(state, { kind: 'selection/set', selection: { kind: 'none' } })).toBe(state)

    const id = asDialogueId('dialogue-1')
    const selected = reduce(state, { kind: 'selection/set', selection: { kind: 'dialogue', id } })
    expect(reduce(selected, { kind: 'selection/set', selection: { kind: 'dialogue', id } })).toBe(
      selected,
    )
  })
})

describe('reduce: ready-scoped actions outside ready', () => {
  it('are ignored rather than throwing, in every non-ready state', () => {
    for (const state of NON_READY_STATES) {
      for (const action of READY_SCOPED_ACTIONS) {
        expect(reduce(state, action)).toBe(state)
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../project/data-file.ts'
import type { AppState, ProjectFile, SaveState } from '../project/types.ts'
import {
  DEBOUNCE_MS,
  MAX_UNSAVED_MS,
  decideOnStoreChange,
  decideOnWrite,
  hasUnsavedEdits,
  needsFlushOnHide,
  nextDebounceMs,
} from './autosave-decision.ts'

function ready(project: ProjectFile, save: SaveState = { kind: 'saved', at: project.savedAt }): AppState {
  return {
    kind: 'ready',
    directoryName: 'Harbour',
    project,
    repairs: { kind: 'none' },
    save,
    selection: { kind: 'none' },
    history: { undo: [], redo: [], coalesceKey: null },
  }
}

const HARBOUR = createEmptyProject('Harbour')
const CAVES = createEmptyProject('Caves')

describe('decideOnStoreChange', () => {
  it('drops the pending write whenever the project is not connected', () => {
    for (const state of [
      { kind: 'disconnected' },
      { kind: 'unsupported' },
      { kind: 'reconnecting', directoryName: 'Harbour' },
      { kind: 'loading', directoryName: 'Harbour' },
      { kind: 'load-failed', directoryName: 'Harbour', message: 'broken' },
    ] satisfies AppState[]) {
      expect(decideOnStoreChange(state, HARBOUR)).toEqual({ kind: 'drop' })
    }
  })

  it('adopts a freshly loaded document as the baseline without scheduling a write', () => {
    expect(decideOnStoreChange(ready(HARBOUR), null)).toEqual({
      kind: 'adopt',
      project: HARBOUR,
    })
  })

  it('schedules nothing while the document reference is unchanged', () => {
    expect(decideOnStoreChange(ready(HARBOUR), HARBOUR)).toEqual({ kind: 'ignore' })
  })

  it('ignores the save state moving under the same document', () => {
    expect(decideOnStoreChange(ready(HARBOUR, { kind: 'pending' }), HARBOUR)).toEqual({
      kind: 'ignore',
    })
    expect(decideOnStoreChange(ready(HARBOUR, { kind: 'saving' }), HARBOUR)).toEqual({
      kind: 'ignore',
    })
    expect(
      decideOnStoreChange(
        ready(HARBOUR, { kind: 'failed', message: 'disk full', failure: 'write' }),
        HARBOUR,
      ),
    ).toEqual({ kind: 'ignore' })
  })

  it('schedules a write for a new document, and hands back the one to adopt', () => {
    const edited: ProjectFile = { ...HARBOUR, dialogues: [] }
    expect(decideOnStoreChange(ready(edited), HARBOUR)).toEqual({
      kind: 'schedule',
      project: edited,
    })
  })

  it('adopts rather than schedules after a disconnect cleared the baseline, so a project switch is never read as an edit', () => {
    expect(decideOnStoreChange({ kind: 'loading', directoryName: 'Caves' }, HARBOUR)).toEqual({
      kind: 'drop',
    })
    expect(decideOnStoreChange(ready(CAVES), null)).toEqual({ kind: 'adopt', project: CAVES })
  })
})

describe('decideOnWrite', () => {
  it('writes the document currently in the store', () => {
    expect(decideOnWrite(ready(HARBOUR), false)).toEqual({ kind: 'write', project: HARBOUR })
  })

  it('queues at most one follow-up while a write is in flight', () => {
    expect(decideOnWrite(ready(HARBOUR), true)).toEqual({ kind: 'queue' })
    expect(decideOnWrite(ready({ ...HARBOUR, zones: [] }), true)).toEqual({ kind: 'queue' }) // a second change during the same write, still just `queue`
  })

  it('queues even when the project has gone away, so the follow-up re-decides', () => {
    expect(decideOnWrite({ kind: 'disconnected' }, true)).toEqual({ kind: 'queue' })
  })

  it('skips a write that came due after the folder was left', () => {
    expect(decideOnWrite({ kind: 'disconnected' }, false)).toEqual({ kind: 'skip' })
    expect(decideOnWrite({ kind: 'loading', directoryName: 'Caves' }, false)).toEqual({
      kind: 'skip',
    })
  })
})

describe('nextDebounceMs', () => {
  it('lets a single edit wait the full debounce', () => {
    expect(nextDebounceMs(1_000, 1_000)).toBe(DEBOUNCE_MS)
  })

  it('shortens the wait as the deadline approaches', () => {
    expect(nextDebounceMs(0, MAX_UNSAVED_MS - 500)).toBe(500)
  })

  it('reaches zero once the deadline has passed, rather than a negative wait', () => {
    expect(nextDebounceMs(0, MAX_UNSAVED_MS + 10_000)).toBe(0)
  })

  it('caps a debounce re-armed every 300 ms so the write happens no later than MAX_UNSAVED_MS after the first edit', () => {
    const editIntervalMs = 300
    for (let now = 0; now <= MAX_UNSAVED_MS + DEBOUNCE_MS; now += editIntervalMs) {
      const wait = nextDebounceMs(0, now)
      if (wait <= editIntervalMs) {
        expect(now + wait).toBeLessThanOrEqual(MAX_UNSAVED_MS) // timer armed at `now` fires before the next edit would arrive
        return
      }
    }
    throw new Error('the debounce never came due')
  })

  it('resets to the full debounce once the streak of unwritten edits starts over', () => {
    const laterEditAt = MAX_UNSAVED_MS * 3
    expect(nextDebounceMs(laterEditAt, laterEditAt)).toBe(DEBOUNCE_MS)
  })
})

describe('hasUnsavedEdits', () => {
  it('counts a failed save, which is where the edits are guaranteed not to be on disk', () => {
    expect(
      hasUnsavedEdits(ready(HARBOUR, { kind: 'failed', message: 'disk full', failure: 'write' })),
    ).toBe(true)
    expect(
      hasUnsavedEdits(
        ready(HARBOUR, { kind: 'failed', message: 'no access', failure: 'permission' }),
      ),
    ).toBe(true)
  })

  it('counts an edit that is on its way to disk', () => {
    expect(hasUnsavedEdits(ready(HARBOUR, { kind: 'pending' }))).toBe(true)
    expect(hasUnsavedEdits(ready(HARBOUR, { kind: 'saving' }))).toBe(true)
  })

  it('is false once the write landed', () => {
    expect(hasUnsavedEdits(ready(HARBOUR, { kind: 'saved', at: HARBOUR.savedAt }))).toBe(false)
  })

  it('is false with no project open — there is nothing to warn about or flush', () => {
    for (const state of [
      { kind: 'disconnected' },
      { kind: 'unsupported' },
      { kind: 'reconnecting', directoryName: 'Harbour' },
      { kind: 'loading', directoryName: 'Harbour' },
      { kind: 'load-failed', directoryName: 'Harbour', message: 'broken' },
    ] satisfies AppState[]) {
      expect(hasUnsavedEdits(state)).toBe(false)
    }
  })
})

describe('needsFlushOnHide', () => {
  it('flushes a failed save — no timer is left to do it, and the edits are only in memory', () => {
    expect(
      needsFlushOnHide(ready(HARBOUR, { kind: 'failed', message: 'disk full', failure: 'write' })),
    ).toBe(true)
  })

  it('flushes a debounced edit that has not come due yet', () => {
    expect(needsFlushOnHide(ready(HARBOUR, { kind: 'pending' }))).toBe(true)
  })

  it('does not flush during a write, unlike the unload warning, since flushing would queue a byte-identical second write', () => {
    const saving = ready(HARBOUR, { kind: 'saving' })
    expect(needsFlushOnHide(saving)).toBe(false)
    expect(hasUnsavedEdits(saving)).toBe(true)
  })

  it('does not flush once the write landed, or with no project open', () => {
    expect(needsFlushOnHide(ready(HARBOUR, { kind: 'saved', at: HARBOUR.savedAt }))).toBe(false)
    expect(needsFlushOnHide({ kind: 'disconnected' })).toBe(false)
  })
})

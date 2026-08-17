import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../project/data-file.ts'
import type { AppState, ProjectFile, SaveState } from '../project/types.ts'
import { decideOnStoreChange, decideOnWrite } from './autosave-decision.ts'

function ready(project: ProjectFile, save: SaveState = { kind: 'saved', at: project.savedAt }): AppState {
  return {
    kind: 'ready',
    directoryName: 'Harbour',
    project,
    save,
    selection: { kind: 'none' },
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
      decideOnStoreChange(ready(HARBOUR, { kind: 'failed', message: 'disk full' }), HARBOUR),
    ).toEqual({ kind: 'ignore' })
  })

  it('schedules a write for a new document, and hands back the one to adopt', () => {
    const edited: ProjectFile = { ...HARBOUR, dialogues: [] }
    expect(decideOnStoreChange(ready(edited), HARBOUR)).toEqual({
      kind: 'schedule',
      project: edited,
    })
  })

  it('adopts rather than schedules after a disconnect cleared the baseline', () => {
    // The sequence that used to write one project into another folder: leave `ready`, load a
    // second project, and the first change back must not be read as an edit of the first.
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
    // A second change during the same write asks again and gets the same answer — the flag it
    // sets is a boolean, so the follow-up count cannot grow past one.
    expect(decideOnWrite(ready({ ...HARBOUR, zones: [] }), true)).toEqual({ kind: 'queue' })
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

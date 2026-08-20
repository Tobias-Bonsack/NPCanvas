import { describe, expect, it } from 'vitest'
import type { ProfileCalibration } from '../capture/capture-profile.ts'
import { createEmptyProject } from './data-file.ts'
import {
  asCaptureProfileId,
  asDialogueId,
  asMapId,
  asMediaId,
  asQuestId,
  asZoneId,
} from './ids.ts'
import type { Action } from './reducer.ts'
import { reduce } from './reducer.ts'
import type {
  AppState,
  CaptureProfile,
  Dialogue,
  DialogueMedia,
  GameMap,
  MapId,
  ProjectFile,
  Quest,
  Zone,
} from './types.ts'

type ReadyState = Extract<AppState, { kind: 'ready' }>

function ready(project: ProjectFile = createEmptyProject('Harbour')): ReadyState {
  return {
    kind: 'ready',
    directoryName: 'Harbour',
    project,
    repairs: { kind: 'none' },
    save: { kind: 'saved', at: project.savedAt },
    selection: { kind: 'none' },
  }
}

/** Narrows a reduced state back to `ready`, so an assertion stays one expression. */
function readyOf(state: AppState): ReadyState {
  if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`)
  return state
}

function gameMap(id: string, name = id): GameMap {
  return {
    id: asMapId(id),
    name,
    file: { fileName: `map-${id}.png`, mimeType: 'image/png', byteSize: 10 },
    width: 100,
    height: 100,
    origin: { x: 0, y: 0 },
    scale: 1,
  }
}

function dialogue(id: string, mapId: MapId): Dialogue {
  return {
    id: asDialogueId(id),
    mapId,
    npcName: id,
    position: { x: 1, y: 2 },
    text: '',
    media: [],
    spokenAt: '2026-08-14T10:00:00.000Z',
    relevance: [],
  }
}

function medium(id: string): DialogueMedia {
  return {
    id: asMediaId(id),
    kind: 'image',
    file: { fileName: `${id}.png`, mimeType: 'image/png', byteSize: 4 },
    width: 2,
    height: 2,
  }
}

function zone(id: string, mapId: MapId): Zone {
  return {
    id: asZoneId(id),
    mapId,
    name: id,
    polygon: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    hue: 200,
  }
}

function quest(id: string, dialogueIds: string[]): Quest {
  return {
    id: asQuestId(id),
    name: id,
    status: 'open',
    dialogueIds: dialogueIds.map(asDialogueId),
    note: '',
    hue: 45,
  }
}

/** A Game Boy screen letterboxed into a 1998 × 1123 window. */
const CALIBRATION: ProfileCalibration = {
  frameWidth: 1998,
  frameHeight: 1123,
  screenRect: { x: 40, y: 90, width: 420, height: 360 },
  nativeWidth: 160,
  nativeHeight: 144,
  textRect: { x: 8, y: 96, width: 144, height: 40 },
}

function captureProfile(id: string, name = id): CaptureProfile {
  return { id: asCaptureProfileId(id), name, ...CALIBRATION, glyphs: [] }
}

/** Two maps, each with a dialogue and a zone, plus a quest spanning both. */
function twoMapProject(): ProjectFile {
  const harbour = gameMap('harbour')
  const forest = gameMap('forest')
  return {
    ...createEmptyProject('Harbour'),
    maps: [harbour, forest],
    zones: [zone('zone-harbour', harbour.id), zone('zone-forest', forest.id)],
    dialogues: [
      dialogue('dialogue-harbour', harbour.id),
      dialogue('dialogue-forest', forest.id),
    ],
    quests: [quest('quest-1', ['dialogue-harbour', 'dialogue-forest'])],
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
  { kind: 'save/failed', message: 'disk full', failure: 'write' },
  { kind: 'selection/set', selection: { kind: 'dialogue', id: asDialogueId('dialogue-1') } },
  { kind: 'map/added', map: gameMap('harbour') },
  { kind: 'map/renamed', mapId: asMapId('harbour'), name: 'Docks' },
  { kind: 'map/moved', mapId: asMapId('harbour'), origin: { x: 10, y: 10 } },
  { kind: 'map/scaled', mapId: asMapId('harbour'), scale: 2 },
  { kind: 'map/deleted', mapId: asMapId('harbour') },
  { kind: 'dialogue/added', dialogue: dialogue('dialogue-1', asMapId('harbour')) },
  { kind: 'dialogue/moved', dialogueId: asDialogueId('dialogue-1'), position: { x: 0, y: 0 } },
  { kind: 'dialogue/npc-named', dialogueId: asDialogueId('dialogue-1'), npcName: 'Ferryman' },
  { kind: 'npc/renamed', from: 'Mara', to: 'Ferryman' },
  { kind: 'dialogue/text-set', dialogueId: asDialogueId('dialogue-1'), text: 'Hello' },
  {
    kind: 'dialogue/media-added',
    dialogueId: asDialogueId('dialogue-1'),
    media: medium('media-1'),
  },
  {
    kind: 'dialogue/media-removed',
    dialogueId: asDialogueId('dialogue-1'),
    mediaId: asMediaId('media-1'),
  },
  {
    kind: 'dialogue/media-reordered',
    dialogueId: asDialogueId('dialogue-1'),
    mediaId: asMediaId('media-1'),
    toIndex: 0,
  },
  {
    kind: 'dialogue/spoken-at-set',
    dialogueId: asDialogueId('dialogue-1'),
    spokenAt: '2026-08-14T10:00:00.000Z',
  },
  { kind: 'dialogue/relevance-set', dialogueId: asDialogueId('dialogue-1'), relevance: ['other'] },
  { kind: 'dialogue/deleted', dialogueId: asDialogueId('dialogue-1') },
  { kind: 'zone/added', zone: zone('zone-1', asMapId('harbour')) },
  { kind: 'zone/renamed', zoneId: asZoneId('zone-1'), name: 'Docks' },
  { kind: 'zone/hue-set', zoneId: asZoneId('zone-1'), hue: 40 },
  {
    kind: 'zone/moved',
    zoneId: asZoneId('zone-1'),
    polygon: [
      { x: 1, y: 1 },
      { x: 11, y: 1 },
      { x: 11, y: 11 },
    ],
  },
  { kind: 'zone/deleted', zoneId: asZoneId('zone-1') },
  { kind: 'quest/added', quest: quest('quest-1', []) },
  { kind: 'quest/renamed', questId: asQuestId('quest-1'), name: 'The missing ledger' },
  { kind: 'quest/note-set', questId: asQuestId('quest-1'), note: 'Ask the harbourmaster' },
  { kind: 'quest/hue-set', questId: asQuestId('quest-1'), hue: 265 },
  { kind: 'quest/status-set', questId: asQuestId('quest-1'), status: 'done' },
  {
    kind: 'quest/dialogue-attached',
    questId: asQuestId('quest-1'),
    dialogueId: asDialogueId('dialogue-1'),
  },
  {
    kind: 'quest/dialogue-detached',
    questId: asQuestId('quest-1'),
    dialogueId: asDialogueId('dialogue-1'),
  },
  { kind: 'quest/deleted', questId: asQuestId('quest-1') },
  { kind: 'capture-profile/added', profile: captureProfile('profile-1') },
  { kind: 'capture-profile/renamed', profileId: asCaptureProfileId('profile-1'), name: 'Red' },
  {
    kind: 'capture-profile/calibrated',
    profileId: asCaptureProfileId('profile-1'),
    calibration: CALIBRATION,
  },
  { kind: 'capture-profile/deleted', profileId: asCaptureProfileId('profile-1') },
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

  // Closing the picker is the same event either way; what it means is not. A project already
  // open must survive it — that is the whole difference between a first connect and a switch.
  it('keeps an open project when the folder picker is cancelled', () => {
    const state = ready()
    expect(reduce(state, { kind: 'project/pick-cancelled' })).toBe(state)
  })

  it('falls back to disconnected when a picker is cancelled with no project open', () => {
    expect(
      reduce(
        { kind: 'load-failed', directoryName: 'Harbour', message: 'boom' },
        { kind: 'project/pick-cancelled' },
      ),
    ).toEqual({ kind: 'disconnected' })

    const disconnected: AppState = { kind: 'disconnected' }
    expect(reduce(disconnected, { kind: 'project/pick-cancelled' })).toBe(disconnected)
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
      { kind: 'project/loaded', directoryName: 'Harbour', project, repairs: { kind: 'none' } },
    )
    expect(next).toEqual({
      kind: 'ready',
      directoryName: 'Harbour',
      project,
      repairs: { kind: 'none' },
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
      repairs: { kind: 'none' },
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

  it('records a failure message and what the retry has to do first', () => {
    const failed = reduce(ready(), { kind: 'save/failed', message: 'disk full', failure: 'write' })
    expect(failed.kind === 'ready' && failed.save).toEqual({
      kind: 'failed',
      message: 'disk full',
      failure: 'write',
    })

    const revoked = reduce(ready(), {
      kind: 'save/failed',
      message: 'no access',
      failure: 'permission',
    })
    expect(revoked.kind === 'ready' && revoked.save).toEqual({
      kind: 'failed',
      message: 'no access',
      failure: 'permission',
    })
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

    const failed = reduce(state, { kind: 'save/failed', message: 'disk full', failure: 'write' })
    expect(reduce(failed, { kind: 'save/failed', message: 'disk full', failure: 'write' })).toBe(
      failed,
    )

    // The same wording out of a different cause is a different failure: the banner offers a
    // permission prompt for one and a plain retry for the other, so it must not be collapsed.
    expect(
      reduce(failed, { kind: 'save/failed', message: 'disk full', failure: 'permission' }),
    ).not.toBe(failed)
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

describe('reduce: map actions', () => {
  it('appends an imported map', () => {
    const map = gameMap('harbour')
    const next = reduce(ready(), { kind: 'map/added', map })
    expect(next.kind === 'ready' && next.project.maps).toEqual([map])
  })

  it('ignores a map whose id the document already holds', () => {
    const state = ready(twoMapProject())
    expect(reduce(state, { kind: 'map/added', map: gameMap('harbour', 'A copy') })).toBe(state)
  })

  it('renames a map without touching the others', () => {
    const next = reduce(ready(twoMapProject()), {
      kind: 'map/renamed',
      mapId: asMapId('harbour'),
      name: 'Docks',
    })
    expect(next.kind === 'ready' && next.project.maps.map((map) => map.name)).toEqual([
      'Docks',
      'forest',
    ])
  })

  it('ignores a rename of a map that does not exist', () => {
    const state = ready(twoMapProject())
    expect(reduce(state, { kind: 'map/renamed', mapId: asMapId('nope'), name: 'Docks' })).toBe(state)
  })

  it('ignores a rename to the name the map already has', () => {
    const state = ready(twoMapProject())
    expect(
      reduce(state, { kind: 'map/renamed', mapId: asMapId('harbour'), name: 'harbour' }),
    ).toBe(state)
  })
})

describe('reduce: map placement', () => {
  it('moves one map without touching the other', () => {
    const next = reduce(ready(twoMapProject()), {
      kind: 'map/moved',
      mapId: asMapId('harbour'),
      origin: { x: -250, y: 80 },
    })
    expect(next.kind === 'ready' && next.project.maps.map((map) => map.origin)).toEqual([
      { x: -250, y: 80 },
      { x: 0, y: 0 },
    ])
  })

  it('ignores a move of a map that does not exist, or to the origin it already has', () => {
    const state = ready(twoMapProject())
    expect(
      reduce(state, { kind: 'map/moved', mapId: asMapId('nope'), origin: { x: 1, y: 1 } }),
    ).toBe(state)
    expect(
      reduce(state, { kind: 'map/moved', mapId: asMapId('harbour'), origin: { x: 0, y: 0 } }),
    ).toBe(state)
  })

  // The origin moves with the scale, which is what makes a nudge read as adjustment rather
  // than as the map drifting off towards the bottom right.
  it('scales a map about its centre', () => {
    const next = reduce(ready(twoMapProject()), {
      kind: 'map/scaled',
      mapId: asMapId('harbour'),
      scale: 2,
    })
    expect(next.kind === 'ready' && next.project.maps[0]).toMatchObject({
      scale: 2,
      origin: { x: -50, y: -50 },
    })
    expect(next.kind === 'ready' && next.project.maps[1].scale).toBe(1)
  })

  it('clamps the scale into the sane range', () => {
    const state = ready(twoMapProject())
    const huge = reduce(state, { kind: 'map/scaled', mapId: asMapId('harbour'), scale: 500 })
    expect(huge.kind === 'ready' && huge.project.maps[0].scale).toBe(10)

    const tiny = reduce(state, { kind: 'map/scaled', mapId: asMapId('harbour'), scale: 0 })
    expect(tiny.kind === 'ready' && tiny.project.maps[0].scale).toBe(0.1)
  })

  it('ignores a scale of a map that does not exist, or one that clamps to the current scale', () => {
    const state = ready(twoMapProject())
    expect(reduce(state, { kind: 'map/scaled', mapId: asMapId('nope'), scale: 2 })).toBe(state)
    expect(reduce(state, { kind: 'map/scaled', mapId: asMapId('harbour'), scale: 1 })).toBe(state)
  })

  it('leaves dialogue positions alone, because they are map-local and ride along', () => {
    const before = twoMapProject()
    const next = reduce(ready(before), {
      kind: 'map/moved',
      mapId: asMapId('harbour'),
      origin: { x: 900, y: 900 },
    })
    expect(next.kind === 'ready' && next.project.dialogues).toBe(before.dialogues)
  })
})

// The cascade is the reason `map/deleted` is one action rather than three: autosave writes
// whatever the store holds after any single dispatch.
describe('reduce: map/deleted cascade', () => {
  it('removes the map with its zones and dialogues, and leaves the other map intact', () => {
    const next = reduce(ready(twoMapProject()), { kind: 'map/deleted', mapId: asMapId('harbour') })
    expect(next.kind === 'ready' && next.project.maps.map((map) => map.id)).toEqual(['forest'])
    expect(next.kind === 'ready' && next.project.zones.map((it) => it.id)).toEqual(['zone-forest'])
    expect(next.kind === 'ready' && next.project.dialogues.map((it) => it.id)).toEqual([
      'dialogue-forest',
    ])
  })

  it('prunes quest references to the deleted dialogues but keeps the quest', () => {
    const next = reduce(ready(twoMapProject()), { kind: 'map/deleted', mapId: asMapId('harbour') })
    expect(next.kind === 'ready' && next.project.quests).toEqual([
      quest('quest-1', ['dialogue-forest']),
    ])
  })

  it('clears a selection that pointed into the deleted map', () => {
    const selectedDialogue = reduce(ready(twoMapProject()), {
      kind: 'selection/set',
      selection: { kind: 'dialogue', id: asDialogueId('dialogue-harbour') },
    })
    const afterDelete = reduce(selectedDialogue, {
      kind: 'map/deleted',
      mapId: asMapId('harbour'),
    })
    expect(afterDelete.kind === 'ready' && afterDelete.selection).toEqual({ kind: 'none' })

    const selectedZone = reduce(ready(twoMapProject()), {
      kind: 'selection/set',
      selection: { kind: 'zone', id: asZoneId('zone-harbour') },
    })
    expect(
      reduce(selectedZone, { kind: 'map/deleted', mapId: asMapId('harbour') }),
    ).toMatchObject({ selection: { kind: 'none' } })
  })

  it('clears a selection of the deleted map itself', () => {
    const selected = reduce(ready(twoMapProject()), {
      kind: 'selection/set',
      selection: { kind: 'map', id: asMapId('harbour') },
    })
    const afterDelete = reduce(selected, { kind: 'map/deleted', mapId: asMapId('harbour') })
    expect(afterDelete.kind === 'ready' && afterDelete.selection).toEqual({ kind: 'none' })
  })

  it('keeps a selection of a map that was not deleted', () => {
    const selected = reduce(ready(twoMapProject()), {
      kind: 'selection/set',
      selection: { kind: 'map', id: asMapId('forest') },
    })
    const afterDelete = reduce(selected, { kind: 'map/deleted', mapId: asMapId('harbour') })
    expect(afterDelete.kind === 'ready' && afterDelete.selection).toEqual({
      kind: 'map',
      id: asMapId('forest'),
    })
  })

  it('keeps a selection that pointed into a surviving map', () => {
    const selected = reduce(ready(twoMapProject()), {
      kind: 'selection/set',
      selection: { kind: 'dialogue', id: asDialogueId('dialogue-forest') },
    })
    const afterDelete = reduce(selected, { kind: 'map/deleted', mapId: asMapId('harbour') })
    expect(afterDelete.kind === 'ready' && afterDelete.selection).toEqual({
      kind: 'dialogue',
      id: asDialogueId('dialogue-forest'),
    })
  })

  it('ignores a delete of a map that does not exist', () => {
    const state = ready(twoMapProject())
    expect(reduce(state, { kind: 'map/deleted', mapId: asMapId('nope') })).toBe(state)
  })
})

describe('reduce: dialogue actions', () => {
  it('appends a placed dialogue', () => {
    const placed = dialogue('dialogue-new', asMapId('harbour'))
    const next = reduce(ready(twoMapProject()), { kind: 'dialogue/added', dialogue: placed })
    expect(next.kind === 'ready' && next.project.dialogues.map((it) => it.id)).toEqual([
      'dialogue-harbour',
      'dialogue-forest',
      'dialogue-new',
    ])
  })

  it('ignores a dialogue placed on a map that does not exist', () => {
    const state = ready(twoMapProject())
    expect(
      reduce(state, { kind: 'dialogue/added', dialogue: dialogue('dialogue-new', asMapId('nope')) }),
    ).toBe(state)
  })

  it('moves a dialogue without touching the others', () => {
    const next = reduce(ready(twoMapProject()), {
      kind: 'dialogue/moved',
      dialogueId: asDialogueId('dialogue-harbour'),
      position: { x: 40, y: 90 },
    })
    expect(next.kind === 'ready' && next.project.dialogues.map((it) => it.position)).toEqual([
      { x: 40, y: 90 },
      { x: 1, y: 2 },
    ])
  })

  it('ignores a move of a dialogue that does not exist, or to the position it already has', () => {
    const state = ready(twoMapProject())
    expect(
      reduce(state, {
        kind: 'dialogue/moved',
        dialogueId: asDialogueId('nope'),
        position: { x: 1, y: 1 },
      }),
    ).toBe(state)
    expect(
      reduce(state, {
        kind: 'dialogue/moved',
        dialogueId: asDialogueId('dialogue-harbour'),
        position: { x: 1, y: 2 },
      }),
    ).toBe(state)
  })

  it('leaves a map selection alone when a dialogue is deleted', () => {
    const selected = reduce(ready(twoMapProject()), {
      kind: 'selection/set',
      selection: { kind: 'map', id: asMapId('harbour') },
    })
    const next = reduce(selected, {
      kind: 'dialogue/deleted',
      dialogueId: asDialogueId('dialogue-harbour'),
    })
    expect(next.kind === 'ready' && next.selection).toEqual({
      kind: 'map',
      id: asMapId('harbour'),
    })
  })

  it('deletes a dialogue, prunes it from quests, and clears the selection', () => {
    const selected = reduce(ready(twoMapProject()), {
      kind: 'selection/set',
      selection: { kind: 'dialogue', id: asDialogueId('dialogue-harbour') },
    })
    const next = reduce(selected, {
      kind: 'dialogue/deleted',
      dialogueId: asDialogueId('dialogue-harbour'),
    })
    expect(next.kind === 'ready' && next.project.dialogues.map((it) => it.id)).toEqual([
      'dialogue-forest',
    ])
    expect(next.kind === 'ready' && next.project.quests).toEqual([
      quest('quest-1', ['dialogue-forest']),
    ])
    expect(next.kind === 'ready' && next.selection).toEqual({ kind: 'none' })
  })

  it('keeps a selection pointing at a different dialogue', () => {
    const selected = reduce(ready(twoMapProject()), {
      kind: 'selection/set',
      selection: { kind: 'dialogue', id: asDialogueId('dialogue-forest') },
    })
    const next = reduce(selected, {
      kind: 'dialogue/deleted',
      dialogueId: asDialogueId('dialogue-harbour'),
    })
    expect(next.kind === 'ready' && next.selection).toEqual({
      kind: 'dialogue',
      id: asDialogueId('dialogue-forest'),
    })
  })

  it('leaves the maps and zones alone when a dialogue is deleted', () => {
    const before = twoMapProject()
    const next = reduce(ready(before), {
      kind: 'dialogue/deleted',
      dialogueId: asDialogueId('dialogue-harbour'),
    })
    expect(next.kind === 'ready' && next.project.maps).toBe(before.maps)
    expect(next.kind === 'ready' && next.project.zones).toBe(before.zones)
  })

  it('ignores a delete of a dialogue that does not exist', () => {
    const state = ready(twoMapProject())
    expect(reduce(state, { kind: 'dialogue/deleted', dialogueId: asDialogueId('nope') })).toBe(state)
  })
})

describe('reduce: dialogue field edits', () => {
  const target = asDialogueId('dialogue-harbour')

  function edited(state: AppState): Dialogue {
    if (state.kind !== 'ready') throw new Error('expected a ready state')
    const found = state.project.dialogues.find((it) => it.id === target)
    if (found === undefined) throw new Error('expected the edited dialogue to survive')
    return found
  }

  it('renames the NPC without touching the other dialogues', () => {
    const before = twoMapProject()
    const next = reduce(ready(before), {
      kind: 'dialogue/npc-named',
      dialogueId: target,
      npcName: 'Ferryman',
    })
    expect(edited(next).npcName).toBe('Ferryman')
    expect(next.kind === 'ready' && next.project.dialogues[1]).toBe(before.dialogues[1])
  })

  it('edits the line', () => {
    const next = reduce(ready(twoMapProject()), {
      kind: 'dialogue/text-set',
      dialogueId: target,
      text: 'The tide takes what it likes.',
    })
    expect(edited(next).text).toBe('The tide takes what it likes.')
  })

  it('edits the line of a dialogue that already carries pictures', () => {
    const next = reduce(ready(projectWithMedia(['a'])), {
      kind: 'dialogue/text-set',
      dialogueId: target,
      text: 'Transcribed from the capture.',
    })
    expect(edited(next).text).toBe('Transcribed from the capture.')
    expect(edited(next).media.map((it) => it.id)).toEqual(['a'])
  })

  it('appends a medium rather than replacing the list', () => {
    const next = reduce(ready(projectWithMedia(['a'])), {
      kind: 'dialogue/media-added',
      dialogueId: target,
      media: medium('b'),
    })
    expect(edited(next).media.map((it) => it.id)).toEqual(['a', 'b'])
  })

  it('removes the middle of three media and leaves the others in order', () => {
    const next = reduce(ready(projectWithMedia(['a', 'b', 'c'])), {
      kind: 'dialogue/media-removed',
      dialogueId: target,
      mediaId: asMediaId('b'),
    })
    expect(edited(next).media.map((it) => it.id)).toEqual(['a', 'c'])
  })

  it('ignores the removal of a medium the dialogue does not own', () => {
    const state = ready(projectWithMedia(['a']))
    expect(
      reduce(state, { kind: 'dialogue/media-removed', dialogueId: target, mediaId: asMediaId('b') }),
    ).toBe(state)
  })

  it('reorders without losing an id, clamping an index past the end', () => {
    const state = ready(projectWithMedia(['a', 'b', 'c']))
    const moved = reduce(state, {
      kind: 'dialogue/media-reordered',
      dialogueId: target,
      mediaId: asMediaId('a'),
      toIndex: 9,
    })
    expect(edited(moved).media.map((it) => it.id)).toEqual(['b', 'c', 'a'])

    const back = reduce(moved, {
      kind: 'dialogue/media-reordered',
      dialogueId: target,
      mediaId: asMediaId('c'),
      toIndex: 0,
    })
    expect(edited(back).media.map((it) => it.id)).toEqual(['c', 'b', 'a'])
  })

  it('treats a move onto a medium’s own position as no change at all', () => {
    const state = ready(projectWithMedia(['a', 'b']))
    expect(
      reduce(state, {
        kind: 'dialogue/media-reordered',
        dialogueId: target,
        mediaId: asMediaId('b'),
        toIndex: 1,
      }),
    ).toBe(state)
  })

  function projectWithMedia(mediaIds: string[]): ProjectFile {
    const project = twoMapProject()
    return {
      ...project,
      dialogues: project.dialogues.map((it) =>
        it.id === target ? { ...it, media: mediaIds.map(medium) } : it,
      ),
    }
  }

  it('replaces the spoken-at instant', () => {
    const next = reduce(ready(twoMapProject()), {
      kind: 'dialogue/spoken-at-set',
      dialogueId: target,
      spokenAt: '2026-08-15T09:30:00.000Z',
    })
    expect(edited(next).spokenAt).toBe('2026-08-15T09:30:00.000Z')
  })

  it('stores relevance deduplicated and in RELEVANCE_TAGS order, whatever the click order', () => {
    const next = reduce(ready(twoMapProject()), {
      kind: 'dialogue/relevance-set',
      dialogueId: target,
      relevance: ['other', 'worldbuilding', 'other', 'out-of-world'],
    })
    expect(edited(next).relevance).toEqual(['out-of-world', 'worldbuilding', 'other'])
  })

  it('treats a reshuffled set of the same tags as no change at all', () => {
    const tagged = reduce(ready(twoMapProject()), {
      kind: 'dialogue/relevance-set',
      dialogueId: target,
      relevance: ['worldbuilding', 'other'],
    })
    expect(
      reduce(tagged, {
        kind: 'dialogue/relevance-set',
        dialogueId: target,
        relevance: ['other', 'worldbuilding', 'worldbuilding'],
      }),
    ).toBe(tagged)
  })

  it('ignores an edit that restates the value, and one naming no dialogue', () => {
    const state = ready(twoMapProject())
    const edits: readonly Action[] = [
      { kind: 'dialogue/npc-named', dialogueId: target, npcName: 'dialogue-harbour' },
      { kind: 'dialogue/text-set', dialogueId: target, text: '' },
      { kind: 'dialogue/spoken-at-set', dialogueId: target, spokenAt: '2026-08-14T10:00:00.000Z' },
      { kind: 'dialogue/relevance-set', dialogueId: target, relevance: [] },
      { kind: 'dialogue/npc-named', dialogueId: asDialogueId('nope'), npcName: 'Ferryman' },
      { kind: 'dialogue/text-set', dialogueId: asDialogueId('nope'), text: 'x' },
      { kind: 'dialogue/spoken-at-set', dialogueId: asDialogueId('nope'), spokenAt: 'x' },
      { kind: 'dialogue/relevance-set', dialogueId: asDialogueId('nope'), relevance: ['other'] },
    ]
    for (const action of edits) expect(reduce(state, action)).toBe(state)
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

describe('reduce: zone actions', () => {
  const HARBOUR = asMapId('harbour')

  function withOneZone(): ReadyState {
    const project: ProjectFile = {
      ...createEmptyProject('Harbour'),
      maps: [gameMap('harbour')],
      zones: [zone('zone-1', HARBOUR)],
      dialogues: [dialogue('dialogue-1', HARBOUR)],
    }
    return ready(project)
  }

  it('appends a drawn zone', () => {
    const onHarbour = ready({ ...createEmptyProject('Harbour'), maps: [gameMap('harbour')] })
    const state = reduce(onHarbour, { kind: 'zone/added', zone: zone('zone-1', HARBOUR) })
    expect(readyOf(state).project.zones.map((each) => each.id)).toEqual([asZoneId('zone-1')])
  })

  it('ignores a zone drawn on a map that does not exist', () => {
    const state = ready(twoMapProject())
    expect(
      reduce(state, { kind: 'zone/added', zone: zone('zone-new', asMapId('nope')) }),
    ).toBe(state)
  })

  it('renames and recolours in place', () => {
    const renamed = reduce(withOneZone(), {
      kind: 'zone/renamed',
      zoneId: asZoneId('zone-1'),
      name: 'Docks',
    })
    expect(readyOf(renamed).project.zones[0].name).toBe('Docks')

    const recoloured = reduce(renamed, { kind: 'zone/hue-set', zoneId: asZoneId('zone-1'), hue: 40 })
    expect(readyOf(recoloured).project.zones[0].hue).toBe(40)
  })

  it('moves a zone without writing to any dialogue', () => {
    const state = withOneZone()
    const before = readyOf(state).project.dialogues
    const moved = reduce(state, {
      kind: 'zone/moved',
      zoneId: asZoneId('zone-1'),
      polygon: [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
      ],
    })
    expect(readyOf(moved).project.zones[0].polygon[0]).toEqual({ x: 5, y: 5 })
    // Reference identity, not deep equality: the point is that nothing was rewritten.
    expect(readyOf(moved).project.dialogues).toBe(before)
  })

  it('deletes a zone and leaves every dialogue in place', () => {
    const state = withOneZone()
    const deleted = reduce(state, { kind: 'zone/deleted', zoneId: asZoneId('zone-1') })
    expect(readyOf(deleted).project.zones).toEqual([])
    expect(readyOf(deleted).project.dialogues).toBe(readyOf(state).project.dialogues)
  })

  it('drops a selection pointing at the deleted zone', () => {
    const selected = reduce(withOneZone(), {
      kind: 'selection/set',
      selection: { kind: 'zone', id: asZoneId('zone-1') },
    })
    const deleted = reduce(selected, { kind: 'zone/deleted', zoneId: asZoneId('zone-1') })
    expect(readyOf(deleted).selection).toEqual({ kind: 'none' })
  })

  it('returns the identical state for an edit that changes nothing', () => {
    const state = withOneZone()
    const current = readyOf(state).project.zones[0]
    expect(reduce(state, { kind: 'zone/renamed', zoneId: current.id, name: current.name })).toBe(
      state,
    )
    expect(reduce(state, { kind: 'zone/hue-set', zoneId: current.id, hue: current.hue })).toBe(state)
    expect(reduce(state, { kind: 'zone/moved', zoneId: current.id, polygon: current.polygon })).toBe(
      state,
    )
    expect(reduce(state, { kind: 'zone/deleted', zoneId: asZoneId('missing') })).toBe(state)
  })
})

describe('reduce: quests', () => {
  const questId = asQuestId('quest-1')

  function edited(state: AppState): Quest {
    const found = readyOf(state).project.quests.find((it) => it.id === questId)
    if (found === undefined) throw new Error('expected the edited quest to survive')
    return found
  }

  it('adds a quest without touching anything else', () => {
    const before = twoMapProject()
    const added = quest('quest-2', [])
    const next = reduce(ready(before), { kind: 'quest/added', quest: added })
    expect(readyOf(next).project.quests.map((it) => it.id)).toEqual(['quest-1', 'quest-2'])
    expect(readyOf(next).project.dialogues).toBe(before.dialogues)
  })

  it('renames a quest and edits its note', () => {
    const renamed = reduce(ready(twoMapProject()), {
      kind: 'quest/renamed',
      questId,
      name: 'The missing ledger',
    })
    expect(edited(renamed).name).toBe('The missing ledger')

    const noted = reduce(renamed, {
      kind: 'quest/note-set',
      questId,
      note: 'Ask the harbourmaster',
    })
    expect(edited(noted).note).toBe('Ask the harbourmaster')
    expect(edited(noted).name).toBe('The missing ledger')
  })

  // Recolouring never touches the status, and marking a quest done never touches its stored
  // hue: `questAccentHue` is what draws a done quest green, so reopening restores its colour.
  it('recolours a quest without disturbing its status', () => {
    const recoloured = reduce(ready(twoMapProject()), { kind: 'quest/hue-set', questId, hue: 265 })
    expect(edited(recoloured).hue).toBe(265)
    expect(edited(recoloured).status).toBe('open')

    const done = reduce(recoloured, { kind: 'quest/status-set', questId, status: 'done' })
    expect(edited(done).hue).toBe(265)
  })

  it('moves a quest between statuses', () => {
    const done = reduce(ready(twoMapProject()), { kind: 'quest/status-set', questId, status: 'done' })
    expect(edited(done).status).toBe('done')
    const reopened = reduce(done, { kind: 'quest/status-set', questId, status: 'open' })
    expect(edited(reopened).status).toBe('open')
  })

  it('attaches a dialogue once, appending it', () => {
    const stripped = reduce(ready(twoMapProject()), {
      kind: 'quest/dialogue-detached',
      questId,
      dialogueId: asDialogueId('dialogue-forest'),
    })
    const attached = reduce(stripped, {
      kind: 'quest/dialogue-attached',
      questId,
      dialogueId: asDialogueId('dialogue-forest'),
    })
    expect(edited(attached).dialogueIds).toEqual(['dialogue-harbour', 'dialogue-forest'])
    // Attaching what is already attached must not duplicate the id, nor wake autosave.
    expect(
      reduce(attached, {
        kind: 'quest/dialogue-attached',
        questId,
        dialogueId: asDialogueId('dialogue-forest'),
      }),
    ).toBe(attached)
  })

  // The other half of the no-dangling-ids invariant; `dialogue/deleted` and `map/deleted` own
  // the removal half, and together they are what let a reader resolve every id it finds.
  it('refuses to attach a dialogue that does not exist', () => {
    const state = ready(twoMapProject())
    expect(
      reduce(state, { kind: 'quest/dialogue-attached', questId, dialogueId: asDialogueId('nope') }),
    ).toBe(state)
  })

  it('detaches a dialogue without deleting it', () => {
    const before = twoMapProject()
    const next = reduce(ready(before), {
      kind: 'quest/dialogue-detached',
      questId,
      dialogueId: asDialogueId('dialogue-harbour'),
    })
    expect(edited(next).dialogueIds).toEqual(['dialogue-forest'])
    expect(readyOf(next).project.dialogues).toBe(before.dialogues)
  })

  it('deletes a quest and leaves every dialogue in place', () => {
    const before = twoMapProject()
    const next = reduce(ready(before), { kind: 'quest/deleted', questId })
    expect(readyOf(next).project.quests).toEqual([])
    expect(readyOf(next).project.dialogues).toBe(before.dialogues)
  })

  it('returns the identical state for an edit that changes nothing', () => {
    const state = ready(twoMapProject())
    const current = readyOf(state).project.quests[0]
    expect(reduce(state, { kind: 'quest/renamed', questId, name: current.name })).toBe(state)
    expect(reduce(state, { kind: 'quest/note-set', questId, note: current.note })).toBe(state)
    expect(reduce(state, { kind: 'quest/hue-set', questId, hue: current.hue })).toBe(state)
    expect(reduce(state, { kind: 'quest/hue-set', questId: asQuestId('missing'), hue: 20 })).toBe(
      state,
    )
    expect(reduce(state, { kind: 'quest/status-set', questId, status: current.status })).toBe(state)
    expect(
      reduce(state, {
        kind: 'quest/dialogue-detached',
        questId,
        dialogueId: asDialogueId('never-attached'),
      }),
    ).toBe(state)
    expect(reduce(state, { kind: 'quest/deleted', questId: asQuestId('missing') })).toBe(state)
  })
})

describe('reduce: npc/renamed', () => {
  const HARBOUR = asMapId('harbour')

  /** Four lines: two by Mara, one by a near-miss name, one with no speaker recorded. */
  function npcProject(): ProjectFile {
    return {
      ...createEmptyProject('Harbour'),
      maps: [gameMap('harbour')],
      dialogues: [
        { ...dialogue('d1', HARBOUR), npcName: 'Mara' },
        { ...dialogue('d2', HARBOUR), npcName: '  Mara  ' },
        { ...dialogue('d3', HARBOUR), npcName: 'Mara the Elder' },
        { ...dialogue('d4', HARBOUR), npcName: '' },
      ],
      quests: [],
    }
  }

  function namesOf(state: AppState): string[] {
    return readyOf(state).project.dialogues.map((each) => each.npcName)
  }

  it('renames every line of one NPC in a single action', () => {
    const next = reduce(ready(npcProject()), { kind: 'npc/renamed', from: 'Mara', to: 'Ferryman' })
    expect(namesOf(next)).toEqual(['Ferryman', 'Ferryman', 'Mara the Elder', ''])
  })

  it('renames only exact matches, case included', () => {
    const state = ready(npcProject())
    expect(namesOf(reduce(state, { kind: 'npc/renamed', from: 'mara', to: 'X' }))).toEqual([
      'Mara',
      '  Mara  ',
      'Mara the Elder',
      '',
    ])
    expect(namesOf(reduce(state, { kind: 'npc/renamed', from: 'Mar', to: 'X' }))).toEqual([
      'Mara',
      '  Mara  ',
      'Mara the Elder',
      '',
    ])
  })

  it('merges two NPCs when the new name is one that already exists', () => {
    const next = reduce(ready(npcProject()), {
      kind: 'npc/renamed',
      from: 'Mara the Elder',
      to: 'Mara',
    })
    const names = new Set(namesOf(next).filter((name) => name.trim() !== ''))
    expect(names).toEqual(new Set(['Mara', '  Mara  ']))
    expect(namesOf(next)[2]).toBe('Mara')
  })

  it('names the lines that never had a speaker, and takes them back', () => {
    const named = reduce(ready(npcProject()), { kind: 'npc/renamed', from: '', to: 'Ferryman' })
    expect(namesOf(named)).toEqual(['Mara', '  Mara  ', 'Mara the Elder', 'Ferryman'])
    expect(namesOf(reduce(named, { kind: 'npc/renamed', from: 'Ferryman', to: '' }))[3]).toBe('')
  })

  it('leaves the other dialogues untouched by reference', () => {
    const before = npcProject()
    const next = readyOf(reduce(ready(before), { kind: 'npc/renamed', from: 'Mara', to: 'X' }))
    expect(next.project.dialogues[2]).toBe(before.dialogues[2])
    expect(next.project.dialogues[3]).toBe(before.dialogues[3])
  })

  it('returns the identical state when nothing matches or the name is unchanged', () => {
    const state = ready(npcProject())
    expect(reduce(state, { kind: 'npc/renamed', from: 'Nobody', to: 'X' })).toBe(state)
    expect(reduce(state, { kind: 'npc/renamed', from: 'Mara', to: '  Mara  ' })).toBe(state)
  })
})

describe('reduce: capture profiles', () => {
  function withOneProfile(): ReadyState {
    return ready({
      ...createEmptyProject('Harbour'),
      captureProfiles: [captureProfile('profile-1', 'Pokémon Red')],
    })
  }

  function profilesOf(state: AppState): CaptureProfile[] {
    return readyOf(state).project.captureProfiles
  }

  it('adds a profile', () => {
    const next = reduce(ready(), {
      kind: 'capture-profile/added',
      profile: captureProfile('profile-1', 'Pokémon Red'),
    })
    expect(profilesOf(next).map((profile) => profile.name)).toEqual(['Pokémon Red'])
  })

  it('renames one', () => {
    const next = reduce(withOneProfile(), {
      kind: 'capture-profile/renamed',
      profileId: asCaptureProfileId('profile-1'),
      name: 'Pokémon Blue',
    })
    expect(profilesOf(next)[0].name).toBe('Pokémon Blue')
  })

  it('re-calibrates one, keeping the glyphs it has learned', () => {
    const learned = ready({
      ...createEmptyProject('Harbour'),
      captureProfiles: [
        { ...captureProfile('profile-1'), glyphs: [{ char: 'A', bits: '0123456789abcdef' }] },
      ],
    })
    const next = reduce(learned, {
      kind: 'capture-profile/calibrated',
      profileId: asCaptureProfileId('profile-1'),
      calibration: {
        ...CALIBRATION,
        frameWidth: 1920,
        frameHeight: 1080,
        screenRect: { x: 10, y: 20, width: 320, height: 288 },
      },
    })
    expect(profilesOf(next)[0].frameWidth).toBe(1920)
    expect(profilesOf(next)[0].screenRect).toEqual({ x: 10, y: 20, width: 320, height: 288 })
    expect(profilesOf(next)[0].glyphs).toEqual([{ char: 'A', bits: '0123456789abcdef' }])
  })

  it('deletes one, and nothing else', () => {
    const state = ready({
      ...createEmptyProject('Harbour'),
      captureProfiles: [captureProfile('profile-1'), captureProfile('profile-2')],
      dialogues: [dialogue('dialogue-1', asMapId('harbour'))],
    })
    const next = reduce(state, {
      kind: 'capture-profile/deleted',
      profileId: asCaptureProfileId('profile-1'),
    })
    expect(profilesOf(next).map((profile) => profile.id)).toEqual([asCaptureProfileId('profile-2')])
    expect(readyOf(next).project.dialogues).toBe(readyOf(state).project.dialogues)
  })

  it('returns the identical state for an unknown id or an unchanged name', () => {
    const state = withOneProfile()
    expect(
      reduce(state, {
        kind: 'capture-profile/renamed',
        profileId: asCaptureProfileId('missing'),
        name: 'X',
      }),
    ).toBe(state)
    expect(
      reduce(state, {
        kind: 'capture-profile/renamed',
        profileId: asCaptureProfileId('profile-1'),
        name: 'Pokémon Red',
      }),
    ).toBe(state)
    expect(
      reduce(state, {
        kind: 'capture-profile/calibrated',
        profileId: asCaptureProfileId('missing'),
        calibration: CALIBRATION,
      }),
    ).toBe(state)
    expect(
      reduce(state, {
        kind: 'capture-profile/deleted',
        profileId: asCaptureProfileId('missing'),
      }),
    ).toBe(state)
  })
})

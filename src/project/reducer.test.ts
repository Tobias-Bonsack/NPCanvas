import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './data-file.ts'
import { asDialogueId, asMapId, asQuestId, asZoneId } from './ids.ts'
import type { Action } from './reducer.ts'
import { reduce } from './reducer.ts'
import type { AppState, Dialogue, GameMap, MapId, ProjectFile, Quest, Zone } from './types.ts'

type ReadyState = Extract<AppState, { kind: 'ready' }>

function ready(project: ProjectFile = createEmptyProject('Harbour')): ReadyState {
  return {
    kind: 'ready',
    directoryName: 'Harbour',
    project,
    save: { kind: 'saved', at: project.savedAt },
    selection: { kind: 'none' },
  }
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
    content: { kind: 'text', text: '' },
    spokenAt: '2026-08-14T10:00:00.000Z',
    relevance: [],
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
  }
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
  { kind: 'save/failed', message: 'disk full' },
  { kind: 'selection/set', selection: { kind: 'dialogue', id: asDialogueId('dialogue-1') } },
  { kind: 'map/added', map: gameMap('harbour') },
  { kind: 'map/renamed', mapId: asMapId('harbour'), name: 'Docks' },
  { kind: 'map/moved', mapId: asMapId('harbour'), origin: { x: 10, y: 10 } },
  { kind: 'map/scaled', mapId: asMapId('harbour'), scale: 2 },
  { kind: 'map/deleted', mapId: asMapId('harbour') },
  { kind: 'dialogue/added', dialogue: dialogue('dialogue-1', asMapId('harbour')) },
  { kind: 'dialogue/moved', dialogueId: asDialogueId('dialogue-1'), position: { x: 0, y: 0 } },
  { kind: 'dialogue/npc-named', dialogueId: asDialogueId('dialogue-1'), npcName: 'Ferryman' },
  { kind: 'dialogue/text-set', dialogueId: asDialogueId('dialogue-1'), text: 'Hello' },
  {
    kind: 'dialogue/spoken-at-set',
    dialogueId: asDialogueId('dialogue-1'),
    spokenAt: '2026-08-14T10:00:00.000Z',
  },
  { kind: 'dialogue/relevance-set', dialogueId: asDialogueId('dialogue-1'), relevance: ['other'] },
  { kind: 'dialogue/deleted', dialogueId: asDialogueId('dialogue-1') },
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

describe('reduce: map actions', () => {
  it('appends an imported map', () => {
    const map = gameMap('harbour')
    const next = reduce(ready(), { kind: 'map/added', map })
    expect(next.kind === 'ready' && next.project.maps).toEqual([map])
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

  it('edits the text body of a text dialogue', () => {
    const next = reduce(ready(twoMapProject()), {
      kind: 'dialogue/text-set',
      dialogueId: target,
      text: 'The tide takes what it likes.',
    })
    expect(edited(next).content).toEqual({
      kind: 'text',
      text: 'The tide takes what it likes.',
    })
  })

  it('refuses to give media content a text body', () => {
    const project = twoMapProject()
    const withImage: ProjectFile = {
      ...project,
      dialogues: project.dialogues.map((it) =>
        it.id === target
          ? {
              ...it,
              content: {
                kind: 'image',
                file: { fileName: 'a.png', mimeType: 'image/png', byteSize: 4 },
                width: 2,
                height: 2,
              },
            }
          : it,
      ),
    }
    const state = ready(withImage)
    expect(reduce(state, { kind: 'dialogue/text-set', dialogueId: target, text: 'x' })).toBe(state)
  })

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

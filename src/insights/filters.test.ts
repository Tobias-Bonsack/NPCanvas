import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asZoneId } from '../project/ids.ts'
import type { Dialogue, DialogueContent, DialogueId, MapId, ZoneId } from '../project/types.ts'
import type { DialogueFilter } from './filters.ts'
import { EMPTY_FILTER, NO_ZONE, applyFilter, isEmptyFilter, toggleFilterValue } from './filters.ts'

const HARBOUR = asMapId('harbour')
const FOREST = asMapId('forest')
const DOCKS = asZoneId('docks')
const MARKET = asZoneId('market')

function dialogue(id: string, overrides: Partial<Dialogue> = {}): Dialogue {
  return {
    id: asDialogueId(id),
    mapId: HARBOUR,
    npcName: 'Mara',
    position: { x: 0, y: 0 },
    content: { kind: 'text', text: '' },
    spokenAt: '2026-08-14T10:00:00.000Z',
    relevance: [],
    ...overrides,
  }
}

const image: DialogueContent = {
  kind: 'image',
  file: { fileName: 'a.png', mimeType: 'image/png', byteSize: 1 },
  width: 10,
  height: 10,
}

/** Four lines that differ on every axis the filter can narrow. */
const MARA = dialogue('mara', {
  npcName: '  Mara  ',
  content: { kind: 'text', text: 'The harbour master owes me a debt' },
  relevance: ['worldbuilding'],
  spokenAt: '2026-08-10T08:00:00.000Z',
})
const TOMAS = dialogue('tomas', {
  npcName: 'Tomas',
  mapId: FOREST,
  content: image,
  relevance: ['peoplebuilding', 'other'],
  spokenAt: '2026-08-12T08:00:00.000Z',
})
const UNNAMED = dialogue('unnamed', {
  npcName: '',
  content: { kind: 'text', text: 'Someone muttering about the debt' },
  relevance: [],
  spokenAt: '2026-08-14T08:00:00.000Z',
})
const BROKEN = dialogue('broken', { npcName: 'Tomas', spokenAt: 'not a date' })

const ALL = [MARA, TOMAS, UNNAMED, BROKEN]

/** Mara in two overlapping zones, Tomas in one, the other two outside every zone. */
const ZONE_INDEX: ReadonlyMap<DialogueId, ZoneId[]> = new Map([
  [MARA.id, [DOCKS, MARKET]],
  [TOMAS.id, [MARKET]],
  [UNNAMED.id, []],
  [BROKEN.id, []],
])

function ids(dialogues: readonly Dialogue[]): string[] {
  return dialogues.map((each) => each.id)
}

function filter(overrides: Partial<DialogueFilter>): DialogueFilter {
  return { ...EMPTY_FILTER, ...overrides }
}

describe('isEmptyFilter', () => {
  it('is true for the empty filter and for whitespace-only text', () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true)
    expect(isEmptyFilter(filter({ text: '   ' }))).toBe(true)
  })

  it('is false as soon as any field narrows', () => {
    expect(isEmptyFilter(filter({ relevance: ['other'] }))).toBe(false)
    expect(isEmptyFilter(filter({ from: '2026-08-01T00:00:00.000Z' }))).toBe(false)
  })
})

describe('applyFilter', () => {
  it('returns everything, in order, for the empty filter', () => {
    expect(applyFilter(ALL, EMPTY_FILTER, ZONE_INDEX)).toEqual(ALL)
  })

  it('matches any of the selected relevance tags', () => {
    expect(ids(applyFilter(ALL, filter({ relevance: ['worldbuilding'] }), ZONE_INDEX))).toEqual([
      'mara',
    ])
    expect(
      ids(applyFilter(ALL, filter({ relevance: ['worldbuilding', 'other'] }), ZONE_INDEX)),
    ).toEqual(['mara', 'tomas'])
  })

  it('matches NPCs by trimmed name, with the empty name standing for unnamed', () => {
    expect(ids(applyFilter(ALL, filter({ npcKeys: ['Mara'] }), ZONE_INDEX))).toEqual(['mara'])
    expect(ids(applyFilter(ALL, filter({ npcKeys: [''] }), ZONE_INDEX))).toEqual(['unnamed'])
    expect(ids(applyFilter(ALL, filter({ npcKeys: ['Mara', 'Tomas'] }), ZONE_INDEX))).toEqual([
      'mara',
      'tomas',
      'broken',
    ])
  })

  it('matches zones through the index, including "outside every zone"', () => {
    expect(ids(applyFilter(ALL, filter({ zones: [DOCKS] }), ZONE_INDEX))).toEqual(['mara'])
    expect(ids(applyFilter(ALL, filter({ zones: [MARKET] }), ZONE_INDEX))).toEqual([
      'mara',
      'tomas',
    ])
    expect(ids(applyFilter(ALL, filter({ zones: [NO_ZONE] }), ZONE_INDEX))).toEqual([
      'unnamed',
      'broken',
    ])
  })

  it('matches maps', () => {
    expect(ids(applyFilter(ALL, filter({ mapIds: [FOREST] }), ZONE_INDEX))).toEqual(['tomas'])
  })

  it('matches content kinds', () => {
    expect(ids(applyFilter(ALL, filter({ contentKinds: ['image'] }), ZONE_INDEX))).toEqual([
      'tomas',
    ])
  })

  it('bounds the date range inclusively and drops unparseable instants', () => {
    const range = filter({ from: '2026-08-10T08:00:00.000Z', to: '2026-08-12T08:00:00.000Z' })
    expect(ids(applyFilter(ALL, range, ZONE_INDEX))).toEqual(['mara', 'tomas'])
    expect(ids(applyFilter(ALL, filter({ from: '2026-08-13T00:00:00.000Z' }), ZONE_INDEX))).toEqual([
      'unnamed',
    ])
    expect(ids(applyFilter(ALL, filter({ to: '2026-08-11T00:00:00.000Z' }), ZONE_INDEX))).toEqual([
      'mara',
    ])
  })

  it('searches the NPC name and the text content, case-insensitively', () => {
    expect(ids(applyFilter(ALL, filter({ text: 'DEBT' }), ZONE_INDEX))).toEqual(['mara', 'unnamed'])
    expect(ids(applyFilter(ALL, filter({ text: 'tomas' }), ZONE_INDEX))).toEqual(['tomas', 'broken'])
  })

  it('combines two fields with AND', () => {
    expect(
      ids(applyFilter(ALL, filter({ text: 'debt', relevance: ['worldbuilding'] }), ZONE_INDEX)),
    ).toEqual(['mara'])
    expect(
      ids(applyFilter(ALL, filter({ zones: [MARKET], mapIds: [FOREST] }), ZONE_INDEX)),
    ).toEqual(['tomas'])
    expect(ids(applyFilter(ALL, filter({ zones: [DOCKS], mapIds: [FOREST] }), ZONE_INDEX))).toEqual(
      [],
    )
  })

  it('treats a dialogue missing from the index as outside every zone', () => {
    const stray: MapId = HARBOUR
    const orphan = dialogue('orphan', { mapId: stray })
    expect(ids(applyFilter([orphan], filter({ zones: [NO_ZONE] }), ZONE_INDEX))).toEqual(['orphan'])
    expect(ids(applyFilter([orphan], filter({ zones: [DOCKS] }), ZONE_INDEX))).toEqual([])
  })
})

describe('toggleFilterValue', () => {
  it('adds a missing value and removes a present one', () => {
    expect(toggleFilterValue([], 'a')).toEqual(['a'])
    expect(toggleFilterValue(['a', 'b'], 'a')).toEqual(['b'])
  })
})

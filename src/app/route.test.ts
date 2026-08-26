import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId, asQuestId, asZoneId } from '../project/ids.ts'
import type { Route } from './route.ts'
import { formatRoute, parseRoute } from './route.ts'

describe('parseRoute', () => {
  it('parses the bare canvas route', () => {
    expect(parseRoute('#/canvas')).toEqual({ kind: 'canvas', dialogueId: null, focus: null })
  })

  it('parses a canvas route naming a dialogue', () => {
    expect(parseRoute('#/canvas?dialogue=d1')).toEqual({
      kind: 'canvas',
      dialogueId: asDialogueId('d1'),
      focus: null,
    })
  })

  it('parses a canvas route focused on a map', () => {
    expect(parseRoute('#/canvas?focus=map:m1')).toEqual({
      kind: 'canvas',
      dialogueId: null,
      focus: { kind: 'map', id: asMapId('m1') },
    })
  })

  it('parses a canvas route focused on a zone', () => {
    expect(parseRoute('#/canvas?focus=zone:z1')).toEqual({
      kind: 'canvas',
      dialogueId: null,
      focus: { kind: 'zone', id: asZoneId('z1') },
    })
  })

  it('parses a canvas route naming both a dialogue and a focus target', () => {
    expect(parseRoute('#/canvas?dialogue=d1&focus=map:m1')).toEqual({
      kind: 'canvas',
      dialogueId: asDialogueId('d1'),
      focus: { kind: 'map', id: asMapId('m1') },
    })
  })

  it('drops a focus param with an unrecognised prefix rather than guessing', () => {
    expect(parseRoute('#/canvas?focus=quest:q1')).toEqual({
      kind: 'canvas',
      dialogueId: null,
      focus: null,
    })
  })

  it('parses the bare quests route', () => {
    expect(parseRoute('#/quests')).toEqual({ kind: 'quests', editQuestId: null })
  })

  it('parses a quests route naming a quest to edit', () => {
    expect(parseRoute('#/quests?edit=q1')).toEqual({
      kind: 'quests',
      editQuestId: asQuestId('q1'),
    })
  })

  it('parses the insights route', () => {
    expect(parseRoute('#/insights')).toEqual({ kind: 'insights' })
  })

  it('parses the settings route', () => {
    expect(parseRoute('#/settings')).toEqual({ kind: 'settings' })
  })

  it('lands the pre-M3.5 #/map/<id> path on the canvas with the id dropped', () => {
    expect(parseRoute('#/map/m1')).toEqual({ kind: 'canvas', dialogueId: null, focus: null })
  })

  it('returns the shared fallback reference for an unparseable hash', () => {
    const first = parseRoute('#/nonsense')
    const second = parseRoute('#/also-nonsense')
    expect(first).toBe(second)
    expect(first).toEqual({ kind: 'canvas', dialogueId: null, focus: null })
  })

  it('tolerates a hash with no leading #', () => {
    expect(parseRoute('insights')).toEqual({ kind: 'insights' })
  })
})

describe('formatRoute', () => {
  const ROUTES: Route[] = [
    { kind: 'canvas', dialogueId: null, focus: null },
    { kind: 'canvas', dialogueId: asDialogueId('d1'), focus: null },
    { kind: 'canvas', dialogueId: null, focus: { kind: 'map', id: asMapId('m1') } },
    { kind: 'canvas', dialogueId: null, focus: { kind: 'zone', id: asZoneId('z1') } },
    {
      kind: 'canvas',
      dialogueId: asDialogueId('d1'),
      focus: { kind: 'map', id: asMapId('m1') },
    },
    { kind: 'quests', editQuestId: null },
    { kind: 'quests', editQuestId: asQuestId('q1') },
    { kind: 'insights' },
    { kind: 'settings' },
  ]

  it.each(ROUTES)('round-trips through parseRoute: %j', (route) => {
    expect(parseRoute(formatRoute(route))).toEqual(route)
  })

  it('omits the query string entirely for the bare canvas route', () => {
    expect(formatRoute({ kind: 'canvas', dialogueId: null, focus: null })).toBe('#/canvas')
  })

  it('omits the query string entirely for the bare quests route', () => {
    expect(formatRoute({ kind: 'quests', editQuestId: null })).toBe('#/quests')
  })
})

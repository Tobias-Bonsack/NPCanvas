import { describe, expect, it } from 'vitest'
import { rectToPolygon } from '../map/geometry.ts'
import { asDialogueId, asMapId, asMediaId, asZoneId } from '../project/ids.ts'
import type { Dialogue, DialogueMedia, GameMap, MapId, Point, ProjectFile, Zone } from '../project/types.ts'
import type { Moment, Reel } from './reel.ts'
import { buildReel } from './reel.ts'

const HARBOUR = asMapId('harbour')

function gameMap(id: MapId): GameMap {
  return {
    id,
    name: String(id),
    file: { fileName: `map-${id}.png`, mimeType: 'image/png', byteSize: 10 },
    width: 200,
    height: 200,
    origin: { x: 0, y: 0 },
    scale: 1,
  }
}

function zone(id: string, mapId: MapId, rect: { x: number; y: number; width: number; height: number }): Zone {
  return { id: asZoneId(id), mapId, name: id, polygon: rectToPolygon(rect), hue: 200 }
}

function dialogue(
  id: string,
  overrides: Partial<Dialogue> & { spokenAt: string },
): Dialogue {
  const position: Point = overrides.position ?? { x: 0, y: 0 }
  return {
    id: asDialogueId(id),
    mapId: HARBOUR,
    npcName: 'Mara',
    position,
    text: '',
    media: [],
    relevance: [],
    references: [],
    ...overrides,
  }
}

function project(dialogues: Dialogue[], zones: Zone[] = [], maps: GameMap[] = [HARBOUR_MAP]): ProjectFile {
  return {
    schemaVersion: 11,
    projectName: 'Test',
    savedAt: '2026-08-15T10:00:00.000Z',
    maps,
    zones,
    dialogues,
    quests: [],
    captureProfiles: [],
    relevanceTags: [],
    glyphs: [],
    pendingCaptures: [],
    recorderBindings: [],
  }
}

const HARBOUR_MAP = gameMap(HARBOUR)

function frame(id: string): DialogueMedia {
  return {
    id: asMediaId(id),
    kind: 'image',
    file: { fileName: `${id}.png`, mimeType: 'image/png', byteSize: 10 },
    width: 10,
    height: 10,
  }
}

/** `count` dialogues, one every `stepMs`, starting at `fromMs` epoch time. */
function every(count: number, fromMs: number, stepMs: number): Dialogue[] {
  return Array.from({ length: count }, (_, index) =>
    dialogue(`d${index}`, { spokenAt: new Date(fromMs + index * stepMs).toISOString() }),
  )
}

describe('buildReel', () => {
  it('gives the reel exactly one moment per datable dialogue, in chronological order', () => {
    const reel: Reel = buildReel(project(every(3, 0, 60_000)))
    const moments: readonly Moment[] = reel.moments
    expect(moments.map((moment) => moment.dialogue.id.toString())).toEqual(['d0', 'd1', 'd2'])
    expect(moments.map((moment) => moment.index)).toEqual([0, 1, 2])
  })

  it('drops a dialogue whose spokenAt will not parse, without shifting later indices', () => {
    const good0 = dialogue('good0', { spokenAt: '2026-08-15T10:00:00.000Z' })
    const broken = dialogue('broken', { spokenAt: 'not a date' })
    const good1 = dialogue('good1', { spokenAt: '2026-08-15T10:01:00.000Z' })
    const reel = buildReel(project([good0, broken, good1]))
    expect(reel.moments.map((moment) => moment.dialogue.id)).toEqual([good0.id, good1.id])
    expect(reel.moments.map((moment) => moment.index)).toEqual([0, 1])
  })

  it('records a zero gap for the very first moment of the whole reel', () => {
    const reel = buildReel(project(every(1, 0, 0)))
    expect(reel.moments[0].gapMsBefore).toBe(0)
  })

  it('carries the real elapsed time as the gap on the moment that follows it', () => {
    const reel = buildReel(project(every(2, 0, 90_000)))
    expect(reel.moments[1].gapMsBefore).toBe(90_000)
  })

  it('keeps a gap of exactly the session threshold inside one session', () => {
    const THIRTY_MIN_MS = 30 * 60_000
    const reel = buildReel(project(every(2, 0, THIRTY_MIN_MS)))
    expect(reel.sessions).toHaveLength(1)
    expect(reel.moments.map((moment) => moment.sessionIndex)).toEqual([0, 0])
  })

  it('opens a new session on a gap one millisecond past the threshold', () => {
    const THIRTY_MIN_MS = 30 * 60_000
    const reel = buildReel(project(every(2, 0, THIRTY_MIN_MS + 1)))
    expect(reel.sessions).toHaveLength(2)
    expect(reel.moments.map((moment) => moment.sessionIndex)).toEqual([0, 1])
  })

  it('has each session point at its own first and last moment and the gap that opened it', () => {
    const THIRTY_MIN_MS = 30 * 60_000
    const dialogues = [
      ...every(2, 0, 60_000), // one session of two lines
      ...every(3, THIRTY_MIN_MS + 1 + 2 * 60_000, 60_000), // a second session of three lines
    ]
    const reel = buildReel(project(dialogues))
    expect(reel.sessions).toHaveLength(2)

    const [first, second] = reel.sessions
    expect(first.gapMsBefore).toBe(0)
    expect(first.firstMoment.dialogue.id).toBe(reel.moments[0].dialogue.id)
    expect(first.lastMoment.dialogue.id).toBe(reel.moments[1].dialogue.id)

    expect(second.gapMsBefore).toBeGreaterThan(THIRTY_MIN_MS)
    expect(second.firstMoment.dialogue.id).toBe(reel.moments[2].dialogue.id)
    expect(second.lastMoment.dialogue.id).toBe(reel.moments[4].dialogue.id)
  })

  it('gives a moment outside every zone a null zoneId', () => {
    const outside = dialogue('outside', { spokenAt: '2026-08-15T10:00:00.000Z', position: { x: 500, y: 500 } })
    const town = zone('town', HARBOUR, { x: 0, y: 0, width: 100, height: 100 })
    const reel = buildReel(project([outside], [town]))
    expect(reel.moments[0].zoneId).toBeNull()
  })

  it('picks the smaller of two nested zones as the moment location', () => {
    const inShop = dialogue('inShop', { spokenAt: '2026-08-15T10:00:00.000Z', position: { x: 20, y: 20 } })
    const town = zone('town', HARBOUR, { x: 0, y: 0, width: 100, height: 100 })
    const shop = zone('shop', HARBOUR, { x: 10, y: 10, width: 20, height: 20 })
    const reel = buildReel(project([inShop], [town, shop]))
    expect(reel.moments[0].zoneId).toBe(shop.id)
  })

  it('pins dwellMs at the minimum clamp for a line with no text and no media', () => {
    const short = dialogue('short', { spokenAt: '2026-08-15T10:00:00.000Z', text: '' })
    const reel = buildReel(project([short]))
    const other = buildReel(project([dialogue('short2', { spokenAt: '2026-08-15T10:00:00.000Z', text: 'x' })]))
    expect(reel.moments[0].dwellMs).toBe(other.moments[0].dwellMs)
  })

  it('pins dwellMs at the maximum clamp for a long line with many frames', () => {
    const monologue = dialogue('monologue', {
      spokenAt: '2026-08-15T10:00:00.000Z',
      text: 'x'.repeat(1245),
      media: Array.from({ length: 27 }, (_, index) => frame(`m${index}`)),
    })
    const reel = buildReel(project([monologue]))
    const evenLonger = dialogue('longer', {
      spokenAt: '2026-08-15T10:00:00.000Z',
      text: 'x'.repeat(5000),
    })
    const evenLongerReel = buildReel(project([evenLonger]))
    expect(reel.moments[0].dwellMs).toBe(evenLongerReel.moments[0].dwellMs)
  })

  it('rebuilds nothing for an unchanged document', () => {
    const doc = project(every(3, 0, 60_000))
    expect(buildReel(doc)).toBe(buildReel(doc))
  })
})

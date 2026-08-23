import { describe, expect, it } from 'vitest'
import { asDialogueId, asMapId } from '../project/ids.ts'
import type { Dialogue, GameMap, MapId, Point } from '../project/types.ts'
import { trailVertices } from './trail-path.ts'

const HARBOUR = asMapId('harbour')
const CAVES = asMapId('caves')

function gameMap(id: MapId, origin: Point, scale = 1): GameMap {
  return {
    id,
    name: id,
    file: { fileName: `${id}.png`, mimeType: 'image/png', byteSize: 1 },
    width: 100,
    height: 100,
    origin,
    scale,
  }
}

function dialogue(id: string, mapId: MapId, spokenAt: string, position: Point): Dialogue {
  return {
    id: asDialogueId(id),
    mapId,
    npcName: id,
    position,
    text: '',
    media: [],
    spokenAt,
    relevance: [],
  }
}

const AT_ORIGIN = gameMap(HARBOUR, { x: 0, y: 0 })
const OFFSET = gameMap(CAVES, { x: 500, y: 40 })

describe('trailVertices', () => {
  it('is empty for no dialogues, and has no segment for a single one', () => {
    expect(trailVertices([AT_ORIGIN], [])).toEqual([])
    expect(
      trailVertices([AT_ORIGIN], [dialogue('a', HARBOUR, '2026-08-15T10:00:00.000Z', { x: 1, y: 2 })]),
    ).toHaveLength(1)
  })

  it('orders by time, not by document order', () => {
    const late = dialogue('late', HARBOUR, '2026-08-15T12:00:00.000Z', { x: 3, y: 3 })
    const early = dialogue('early', HARBOUR, '2026-08-15T09:00:00.000Z', { x: 1, y: 1 })
    const middle = dialogue('middle', HARBOUR, '2026-08-15T10:30:00.000Z', { x: 2, y: 2 })

    expect(trailVertices([AT_ORIGIN], [late, early, middle]).map((vertex) => vertex.id)).toEqual([
      early.id,
      middle.id,
      late.id,
    ])
  })

  it('compares instants rather than the ISO strings, so an offset sorts by what it means', () => {
    // 09:00+02:00 is 07:00Z — earlier in time, later as text.
    const offset = dialogue('offset', HARBOUR, '2026-08-15T09:00:00.000+02:00', { x: 1, y: 1 })
    const utc = dialogue('utc', HARBOUR, '2026-08-15T08:00:00.000Z', { x: 2, y: 2 })

    expect(trailVertices([AT_ORIGIN], [utc, offset]).map((vertex) => vertex.id)).toEqual([
      offset.id,
      utc.id,
    ])
  })

  it('keeps document order for lines sharing one instant', () => {
    const first = dialogue('first', HARBOUR, '2026-08-15T10:00:00.000Z', { x: 1, y: 1 })
    const second = dialogue('second', HARBOUR, '2026-08-15T10:00:00.000Z', { x: 2, y: 2 })

    expect(trailVertices([AT_ORIGIN], [first, second]).map((vertex) => vertex.id)).toEqual([
      first.id,
      second.id,
    ])
    expect(trailVertices([AT_ORIGIN], [second, first]).map((vertex) => vertex.id)).toEqual([
      second.id,
      first.id,
    ])
  })

  it('drops a line whose spokenAt does not parse', () => {
    const broken = dialogue('broken', HARBOUR, 'not a date', { x: 1, y: 1 })
    const good = dialogue('good', HARBOUR, '2026-08-15T10:00:00.000Z', { x: 2, y: 2 })

    expect(trailVertices([AT_ORIGIN], [broken, good]).map((vertex) => vertex.id)).toEqual([good.id])
  })

  it('drops a line whose map is not on the canvas', () => {
    const stranded = dialogue('stranded', CAVES, '2026-08-15T09:00:00.000Z', { x: 1, y: 1 })
    const placed = dialogue('placed', HARBOUR, '2026-08-15T10:00:00.000Z', { x: 2, y: 2 })

    expect(trailVertices([AT_ORIGIN], [stranded, placed]).map((vertex) => vertex.id)).toEqual([
      placed.id,
    ])
  })

  it('threads two maps in one chain, in canvas space', () => {
    const onHarbour = dialogue('h', HARBOUR, '2026-08-15T09:00:00.000Z', { x: 10, y: 20 })
    const onCaves = dialogue('c', CAVES, '2026-08-15T10:00:00.000Z', { x: 10, y: 20 })

    expect(trailVertices([AT_ORIGIN, OFFSET], [onCaves, onHarbour])).toEqual([
      { id: onHarbour.id, point: { x: 10, y: 20 } },
      { id: onCaves.id, point: { x: 510, y: 60 } },
    ])
  })

  it("takes each point through its own map's origin and scale", () => {
    const scaled = gameMap(HARBOUR, { x: 100, y: 100 }, 2)
    const line = dialogue('a', HARBOUR, '2026-08-15T10:00:00.000Z', { x: 10, y: 5 })

    expect(trailVertices([scaled], [line])).toEqual([{ id: line.id, point: { x: 120, y: 110 } }])
  })
})

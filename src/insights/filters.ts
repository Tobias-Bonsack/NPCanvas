import type {
  Dialogue,
  DialogueContentKind,
  DialogueId,
  MapId,
  RelevanceTag,
  ZoneId,
} from '../project/types.ts'
import { dialogueContentKind } from '../project/types.ts'
import { dialogueSearchText } from '../search/dialogue-search-text.ts'

export type ContentKind = DialogueContentKind

/**
 * "Outside every zone", as a filter value. A branded `ZoneId` can never equal this literal, so
 * the union stays machine-checkable — and the breakdown's "Outside any zone" row becomes
 * clickable like every other row, which a bare `ZoneId[]` could not express.
 */
export const NO_ZONE = 'no-zone'
export type ZoneScope = ZoneId | typeof NO_ZONE

/**
 * Which dialogues an insights view is looking at. Every field is a *narrowing*: empty means
 * "no opinion", never "match nothing". Fields combine with AND, values inside one field with
 * OR — so `relevance: [a, b], mapIds: [m]` reads as "tagged a or b, and on map m".
 *
 * The NPC field holds `npcKey` values (the trimmed name, `''` for unnamed), not raw
 * `npcName`s: two dialogues whose names differ only by trailing space are one NPC everywhere
 * else in this view, and a filter that disagreed would drop half of them.
 */
export type DialogueFilter = {
  relevance: readonly RelevanceTag[]
  npcKeys: readonly string[]
  zones: readonly ZoneScope[]
  mapIds: readonly MapId[]
  contentKinds: readonly ContentKind[]
  /** Inclusive ISO 8601 bounds on `spokenAt`; `null` is unbounded on that side. */
  from: string | null
  to: string | null
  /** Free text over the NPC name and the text content. Case-insensitive substring. */
  text: string
}

export const EMPTY_FILTER: DialogueFilter = {
  relevance: [],
  npcKeys: [],
  zones: [],
  mapIds: [],
  contentKinds: [],
  from: null,
  to: null,
  text: '',
}

export function isEmptyFilter(filter: DialogueFilter): boolean {
  return (
    filter.relevance.length === 0 &&
    filter.npcKeys.length === 0 &&
    filter.zones.length === 0 &&
    filter.mapIds.length === 0 &&
    filter.contentKinds.length === 0 &&
    filter.from === null &&
    filter.to === null &&
    filter.text.trim() === ''
  )
}

/**
 * The dialogues the filter admits, in the order they were given.
 *
 * Pure, and takes the zone index rather than the zones: location is derived, never stored (see
 * CLAUDE.md), and every caller already holds the index the canvas and the board build.
 */
export function applyFilter(
  dialogues: readonly Dialogue[],
  filter: DialogueFilter,
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
): Dialogue[] {
  const needle = filter.text.trim().toLowerCase()
  const from = filter.from === null ? null : Date.parse(filter.from)
  const to = filter.to === null ? null : Date.parse(filter.to)

  return dialogues.filter((dialogue) => {
    if (filter.mapIds.length > 0 && !filter.mapIds.includes(dialogue.mapId)) return false

    if (filter.npcKeys.length > 0 && !filter.npcKeys.includes(npcKey(dialogue))) return false

    if (
      filter.contentKinds.length > 0 &&
      !filter.contentKinds.includes(dialogueContentKind(dialogue))
    ) {
      return false
    }

    // OR across the selected tags, so an untagged dialogue can never match a tag filter.
    if (
      filter.relevance.length > 0 &&
      !filter.relevance.some((tag) => dialogue.relevance.includes(tag))
    ) {
      return false
    }

    if (filter.zones.length > 0 && !matchesZones(dialogue, filter.zones, zoneIndex)) return false

    if (from !== null || to !== null) {
      const at = Date.parse(dialogue.spokenAt)
      // An unparseable instant cannot be placed on the axis, so a bounded range excludes it
      // rather than guessing. Unbounded, it still shows up everywhere else.
      if (Number.isNaN(at)) return false
      if (from !== null && !Number.isNaN(from) && at < from) return false
      if (to !== null && !Number.isNaN(to) && at > to) return false
    }

    if (needle !== '' && !dialogueSearchText(dialogue).includes(needle)) return false

    return true
  })
}

/** A dialogue is in `NO_ZONE` when its zone list is empty — the index gives every dialogue one. */
function matchesZones(
  dialogue: Dialogue,
  zones: readonly ZoneScope[],
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
): boolean {
  const inside = zoneIndex.get(dialogue.id) ?? []
  return zones.some((scope) => (scope === NO_ZONE ? inside.length === 0 : inside.includes(scope)))
}

/**
 * The identity of an NPC across dialogues. Trimmed, because the name is free text typed once
 * per line; `''` is the real answer for a line logged before its speaker was known, and
 * `npcLabel` is what turns it into something readable.
 */
export function npcKey(dialogue: Dialogue): string {
  return dialogue.npcName.trim()
}

export const UNNAMED_NPC = 'Unnamed'

export function npcLabel(key: string): string {
  return key === '' ? UNNAMED_NPC : key
}

/**
 * A value added to or removed from one OR-field. Every chip and every clickable chart segment
 * goes through this, so clicking a thing twice always undoes it.
 */
export function toggleFilterValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((each) => each !== value) : [...values, value]
}

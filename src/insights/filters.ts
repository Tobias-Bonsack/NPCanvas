import { searchTextOf } from '../project/derived.ts'
import type {
  Dialogue,
  DialogueContentKind,
  DialogueId,
  MapId,
  RelevanceTagId,
  ZoneId,
} from '../project/types.ts'
import { dialogueContentKind } from '../project/types.ts'

export type ContentKind = DialogueContentKind

// "Outside every zone" as a filter value — a branded ZoneId can never equal this literal, so
// the breakdown's "Outside any zone" row is clickable like every other row.
export const NO_ZONE = 'no-zone'
export type ZoneScope = ZoneId | typeof NO_ZONE

// Every field is a narrowing: empty means "no opinion", never "match nothing". Fields combine
// with AND, values inside one field with OR. npcKeys holds trimmed names (npcKey), not raw
// npcName, so two names differing only by trailing space are one NPC here too.
export type DialogueFilter = {
  relevance: readonly RelevanceTagId[]
  npcKeys: readonly string[]
  zones: readonly ZoneScope[]
  mapIds: readonly MapId[]
  contentKinds: readonly ContentKind[]
  from: string | null
  to: string | null
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

// Takes the zone index, not the zones — location is derived, never stored.
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
      // An unparseable instant can't be placed on the axis, so a bounded range excludes it.
      if (Number.isNaN(at)) return false
      if (from !== null && !Number.isNaN(from) && at < from) return false
      if (to !== null && !Number.isNaN(to) && at > to) return false
    }

    if (needle !== '' && !searchTextOf(dialogue, dialogues).includes(needle)) return false

    return true
  })
}

function matchesZones(
  dialogue: Dialogue,
  zones: readonly ZoneScope[],
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>,
): boolean {
  const inside = zoneIndex.get(dialogue.id) ?? []
  return zones.some((scope) => (scope === NO_ZONE ? inside.length === 0 : inside.includes(scope)))
}

// '' is the real answer for a line logged before its speaker was known; npcLabel renders it.
export function npcKey(dialogue: Dialogue): string {
  return dialogue.npcName.trim()
}

const UNNAMED_NPC = 'Unnamed'

export function npcLabel(key: string): string {
  return key === '' ? UNNAMED_NPC : key
}

export function toggleFilterValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((each) => each !== value) : [...values, value]
}

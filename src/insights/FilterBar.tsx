import type { CSSProperties, ReactElement } from 'react'
import { useMemo } from 'react'
import { relevanceHueStyle } from '../dialogue/relevance.ts'
import { zoneHueStyle } from '../map/zone-style.ts'
import type { Dialogue, GameMap, ProjectFile, RelevanceTagId, Zone } from '../project/types.ts'
import { DIALOGUE_CONTENT_KINDS } from '../project/types.ts'
import type { ContentKind, DialogueFilter, ZoneScope } from './filters.ts'
import {
  EMPTY_FILTER,
  NO_ZONE,
  isEmptyFilter,
  npcKey,
  npcLabel,
  toggleFilterValue,
} from './filters.ts'

const CONTENT_KIND_LABEL: Record<ContentKind, string> = {
  text: 'Text',
  image: 'Image',
  gif: 'GIF',
  video: 'Clip',
}

// The filter is a prop, returned through onChange — the bar owns none of it. Tags/content kinds
// are chips (few, fixed); maps/zones/NPCs are "add one" selects plus removable chips, since
// those lists grow and a chart click can add several values a single <select> couldn't show.
export function FilterBar({
  project,
  filter,
  onChange,
}: {
  project: ProjectFile
  filter: DialogueFilter
  onChange: (filter: DialogueFilter) => void
}): ReactElement {
  const npcKeys = useMemo(() => sortedNpcKeys(project.dialogues), [project.dialogues])
  const mapsById = useMemo(() => byId(project.maps), [project.maps])
  const zonesById = useMemo(() => byId(project.zones), [project.zones])

  // Annotated so the "Outside any zone" entry doesn't widen the element type to `string`.
  const zoneOptions: { value: ZoneScope; label: string }[] = project.zones
    .filter((zone) => !filter.zones.includes(zone.id))
    .map((zone) => ({ value: zone.id, label: zoneLabel(zone) }))
  if (!filter.zones.includes(NO_ZONE)) {
    zoneOptions.push({ value: NO_ZONE, label: 'Outside any zone' })
  }

  const invertedRange =
    filter.from !== null &&
    filter.to !== null &&
    Date.parse(filter.from) > Date.parse(filter.to)

  return (
    <section className="filter-bar" aria-label="Filter dialogues">
      <div className="filter-bar__row">
        <input
          className="filter-bar__search text-input"
          type="search"
          value={filter.text}
          placeholder="Search NPC names and what was said"
          aria-label="Search dialogues"
          onChange={(event) => onChange({ ...filter, text: event.target.value })}
        />
        <label className="filter-bar__date micro-label">
          From
          <input
            className="text-input"
            type="date"
            value={toDateInputValue(filter.from)}
            // A typed-in date can still bypass this cap, hence invertedRange below too.
            max={toDateInputValue(filter.to)}
            onChange={(event) =>
              onChange({ ...filter, from: fromDateInputValue(event.target.value, 'start') })
            }
          />
        </label>
        <label className="filter-bar__date micro-label">
          To
          <input
            className="text-input"
            type="date"
            value={toDateInputValue(filter.to)}
            min={toDateInputValue(filter.from)}
            onChange={(event) =>
              onChange({ ...filter, to: fromDateInputValue(event.target.value, 'end') })
            }
          />
        </label>
        <button
          type="button"
          className="button"
          disabled={isEmptyFilter(filter)}
          onClick={() => onChange(EMPTY_FILTER)}
        >
          Clear filters
        </button>
      </div>

      {invertedRange && (
        <p className="error-text" role="alert">
          "From" is after "To" — no dialogue can be spoken in a range that ends before it starts.
        </p>
      )}

      <div className="filter-bar__row">
        <div className="filter-bar__chips" role="group" aria-label="Relevance">
          {project.relevanceTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="filter-bar__tag hue-chip"
              style={relevanceHueStyle(tag.hue)}
              aria-pressed={filter.relevance.includes(tag.id)}
              onClick={() =>
                onChange({
                  ...filter,
                  relevance: toggleFilterValue<RelevanceTagId>(filter.relevance, tag.id),
                })
              }
            >
              {tag.name}
            </button>
          ))}
        </div>

        <div className="filter-bar__chips" role="group" aria-label="Content kind">
          {DIALOGUE_CONTENT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="filter-bar__kind hue-chip"
              aria-pressed={filter.contentKinds.includes(kind)}
              onClick={() =>
                onChange({
                  ...filter,
                  contentKinds: toggleFilterValue<ContentKind>(filter.contentKinds, kind),
                })
              }
            >
              {CONTENT_KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-bar__row">
        <AddSelect
          label="Map"
          options={project.maps
            .filter((map) => !filter.mapIds.includes(map.id))
            .map((map) => ({ value: map.id, label: mapLabel(map) }))}
          onAdd={(value) => onChange({ ...filter, mapIds: [...filter.mapIds, value] })}
        />
        <AddSelect
          label="Zone"
          options={zoneOptions}
          onAdd={(value) => onChange({ ...filter, zones: [...filter.zones, value] })}
        />
        <AddSelect
          label="NPC"
          options={npcKeys
            .filter((key) => !filter.npcKeys.includes(key))
            .map((key) => ({ value: key, label: npcLabel(key) }))}
          onAdd={(value) => onChange({ ...filter, npcKeys: [...filter.npcKeys, value] })}
        />
      </div>

      {(filter.mapIds.length > 0 || filter.zones.length > 0 || filter.npcKeys.length > 0) && (
        <div className="filter-bar__row filter-bar__row--active" aria-label="Active filters">
          {filter.mapIds.map((mapId) => (
            <ActiveChip
              key={mapId}
              label={`Map: ${labelOf(mapsById.get(mapId), mapLabel, 'Unknown map')}`}
              onRemove={() =>
                onChange({ ...filter, mapIds: filter.mapIds.filter((each) => each !== mapId) })
              }
            />
          ))}
          {filter.zones.map((scope) => (
            <ActiveChip
              key={scope}
              label={`Zone: ${
                scope === NO_ZONE
                  ? 'Outside any zone'
                  : labelOf(zonesById.get(scope), zoneLabel, 'Unknown zone')
              }`}
              style={scope === NO_ZONE ? undefined : zoneHueStyle(zonesById.get(scope)?.hue ?? 0)}
              onRemove={() =>
                onChange({ ...filter, zones: filter.zones.filter((each) => each !== scope) })
              }
            />
          ))}
          {filter.npcKeys.map((key) => (
            <ActiveChip
              key={`npc:${key}`}
              label={`NPC: ${npcLabel(key)}`}
              onRemove={() =>
                onChange({ ...filter, npcKeys: filter.npcKeys.filter((each) => each !== key) })
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}

// Prefixed so a real option's DOM value never collides with the placeholder's "" — an NPC's
// npcKey is '' for "unnamed", a legitimate value this field must offer.
const OPTION_PREFIX = 'v:'

// Never holds a selection — picking an option appends it to an OR-field and snaps back to its
// own name. Options are keyed by String(value), not list position, since options rebuilds from
// the live document every render and could reorder between render and the change event.
function AddSelect<T>({
  label,
  options,
  onAdd,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  onAdd: (value: T) => void
}): ReactElement {
  return (
    <select
      className="filter-bar__select text-input"
      value=""
      aria-label={`Add ${label.toLowerCase()} filter`}
      disabled={options.length === 0}
      onChange={(event) => {
        const raw = event.target.value
        if (!raw.startsWith(OPTION_PREFIX)) return
        const key = raw.slice(OPTION_PREFIX.length)
        const option = options.find((candidate) => String(candidate.value) === key)
        if (option === undefined) return
        onAdd(option.value)
      }}
    >
      <option value="">{options.length === 0 ? `${label}: none left` : `${label}…`}</option>
      {options.map((option) => (
        <option key={String(option.value)} value={`${OPTION_PREFIX}${String(option.value)}`}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function ActiveChip({
  label,
  style,
  onRemove,
}: {
  label: string
  style?: CSSProperties
  onRemove: () => void
}): ReactElement {
  return (
    <button type="button" className="filter-bar__active hue-chip" style={style} onClick={onRemove}>
      {label}
      <span className="filter-bar__remove" aria-hidden="true">
        ×
      </span>
      <span className="visually-hidden">Remove filter</span>
    </button>
  )
}

function sortedNpcKeys(dialogues: readonly Dialogue[]): string[] {
  const keys = new Set<string>()
  for (const dialogue of dialogues) keys.add(npcKey(dialogue))
  return [...keys].sort((a, b) => npcLabel(a).localeCompare(npcLabel(b)))
}

function mapLabel(map: GameMap): string {
  return map.name.trim() === '' ? 'Untitled map' : map.name
}

function zoneLabel(zone: Zone): string {
  return zone.name.trim() === '' ? 'Unnamed zone' : zone.name
}

// A filter may name something deleted between renders; the chip says so instead of blanking.
function labelOf<T>(item: T | undefined, label: (item: T) => string, fallback: string): string {
  return item === undefined ? fallback : label(item)
}

function byId<T extends { id: PropertyKey }>(items: readonly T[]): ReadonlyMap<T['id'], T> {
  const map = new Map<T['id'], T>()
  for (const item of items) map.set(item.id, item)
  return map
}

// <input type="date"> is wall-clock, spokenAt is an instant — a bound picked as a day means the
// whole local day, so `from` is its first millisecond and `to` its last.
function toDateInputValue(iso: string | null): string {
  if (iso === null) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function fromDateInputValue(value: string, edge: 'start' | 'end'): string | null {
  const match = DATE_PATTERN.exec(value)
  if (match === null) return null
  const [, year, month, day] = match
  const date =
    edge === 'start'
      ? new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0)
      : new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

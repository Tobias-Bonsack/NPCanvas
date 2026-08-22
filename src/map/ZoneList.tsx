import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { navigate } from '../app/route.ts'
import { assertNever } from '../assert-never.ts'
import { dispatch } from '../project/store.ts'
import type { GameMap, MapId, ProjectFile, Zone, ZoneId } from '../project/types.ts'
import type { RowTrigger } from './row-focus.ts'
import { useRowFocus } from './row-focus.ts'
import { ZONE_HUES, zoneHueStyle } from './zone-style.ts'

/**
 * Transient list UI — the rename draft, the open palette, the delete confirmation — is
 * component state, never the store. See CLAUDE.md § Store scope. One mode for the whole list
 * rather than one per row, because only one row can be mid-edit at a time.
 */
type ZoneListMode =
  | { kind: 'idle' }
  | { kind: 'renaming'; id: ZoneId; draft: string }
  | { kind: 'recolouring'; id: ZoneId }
  | { kind: 'confirming-delete'; id: ZoneId }

/**
 * Every zone in the project, grouped under the map it is drawn on — a zone's polygon is
 * meaningless without knowing which map's pixels it is in, so the grouping is the only
 * honest flat presentation.
 */
export function ZoneList({
  project,
  selectedId,
  counts,
}: {
  project: ProjectFile
  selectedId: ZoneId | null
  /**
   * Dialogues per zone, derived — see `zone-index.ts`. A zone with none is simply absent from
   * the map, which is why every read here defaults to zero.
   */
  counts: ReadonlyMap<ZoneId, number>
}): ReactElement {
  const [mode, setMode] = useState<ZoneListMode>({ kind: 'idle' })

  // One pass instead of one filter per map: a scan per group is O(maps × zones), and this
  // list re-renders whenever the zone counts do, which is every frame of a zone drag.
  const byMap = useMemo(
    () => groupByMap(project.maps, project.zones),
    [project.maps, project.zones],
  )

  /**
   * The same one-shot `focus` channel `MapList` jumps a map with — see `route.ts`'s
   * `FocusTarget` — so a zone off screen reads as "jumped to" instead of "nothing happened".
   */
  function onFocus(zone: Zone): void {
    dispatch({ kind: 'selection/set', selection: { kind: 'zone', id: zone.id } })
    navigate({ kind: 'canvas', dialogueId: null, focus: { kind: 'zone', id: zone.id } })
  }

  function onRenameSubmit(id: ZoneId, draft: string): void {
    const name = draft.trim()
    if (name !== '') dispatch({ kind: 'zone/renamed', zoneId: id, name })
    setMode({ kind: 'idle' })
  }

  return (
    <div className="zone-list">
      <h2 className="map-list__heading">Zones</h2>
      {project.zones.length === 0 ? (
        <p className="zone-list__empty">
          Pick <strong>Draw zone</strong> and drag a rectangle on a map. Every dialogue pinned
          inside it counts as having happened there.
        </p>
      ) : (
        project.maps.map((map) => (
          <ZoneGroup
            key={map.id}
            map={map}
            zones={byMap.get(map.id) ?? NO_ZONES}
            selectedId={selectedId}
            counts={counts}
            mode={mode}
            onSetMode={setMode}
            onFocus={onFocus}
            onRenameSubmit={onRenameSubmit}
          />
        ))
      )}
    </div>
  )
}

/** One shared empty array, so a map with no zones is handed the same reference every render. */
const NO_ZONES: readonly Zone[] = []

/** Zones bucketed by map, in one pass — the same shape `ZoneLayer` builds, for the same reason. */
function groupByMap(maps: readonly GameMap[], zones: readonly Zone[]): ReadonlyMap<MapId, Zone[]> {
  const byMap = new Map<MapId, Zone[]>()
  for (const map of maps) byMap.set(map.id, [])
  for (const zone of zones) byMap.get(zone.mapId)?.push(zone)
  return byMap
}

/** Renders nothing at all for a map with no zones — an empty heading is noise in a sidebar. */
function ZoneGroup({
  map,
  zones,
  selectedId,
  counts,
  mode,
  onSetMode,
  onFocus,
  onRenameSubmit,
}: {
  map: GameMap
  zones: readonly Zone[]
  selectedId: ZoneId | null
  counts: ReadonlyMap<ZoneId, number>
  mode: ZoneListMode
  onSetMode: (mode: ZoneListMode) => void
  onFocus: (zone: Zone) => void
  onRenameSubmit: (id: ZoneId, draft: string) => void
}): ReactElement | null {
  if (zones.length === 0) return null
  return (
    <>
      <h3 className="zone-list__map">{map.name}</h3>
      <ul className="map-list__items">
        {zones.map((zone) => (
          <li key={zone.id} className="map-list__item">
            <ZoneRow
              zone={zone}
              selected={zone.id === selectedId}
              count={counts.get(zone.id) ?? 0}
              // Only the row the mode names is in that mode; every other row stays idle.
              mode={'id' in mode && mode.id === zone.id ? mode : { kind: 'idle' }}
              onSetMode={onSetMode}
              onFocus={() => onFocus(zone)}
              onRenameSubmit={(draft) => onRenameSubmit(zone.id, draft)}
            />
          </li>
        ))}
      </ul>
    </>
  )
}

/** Exhaustive over `ZoneListMode`; the `ReactElement` return type rejects a silently added one. */
function ZoneRow({
  zone,
  selected,
  count,
  mode,
  onSetMode,
  onFocus,
  onRenameSubmit,
}: {
  zone: Zone
  selected: boolean
  /** Dialogues currently inside, recomputed from the geometry on every state change. */
  count: number
  mode: ZoneListMode
  onSetMode: (mode: ZoneListMode) => void
  onFocus: () => void
  onRenameSubmit: (draft: string) => void
}): ReactElement {
  const triggerRef = useRowFocus(triggerOf(mode))

  switch (mode.kind) {
    case 'renaming':
      return (
        <form
          className="map-list__form"
          onSubmit={(event) => {
            event.preventDefault()
            onRenameSubmit(mode.draft)
          }}
        >
          <input
            className="map-list__input"
            value={mode.draft}
            autoFocus
            aria-label="Zone name"
            onChange={(event) =>
              onSetMode({ kind: 'renaming', id: zone.id, draft: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape') onSetMode({ kind: 'idle' })
            }}
          />
          <button type="submit" className="map-list__button">
            Save
          </button>
          <button
            type="button"
            className="map-list__button"
            onClick={() => onSetMode({ kind: 'idle' })}
          >
            Cancel
          </button>
        </form>
      )

    case 'recolouring':
      return (
        <div className="zone-list__palette" role="group" aria-label={`Colour of ${zone.name}`}>
          {ZONE_HUES.map((hue) => (
            <button
              key={hue}
              type="button"
              className="zone-list__swatch"
              style={zoneHueStyle(hue)}
              aria-label={`Hue ${hue}`}
              aria-pressed={hue === zone.hue}
              onClick={() => {
                dispatch({ kind: 'zone/hue-set', zoneId: zone.id, hue })
                onSetMode({ kind: 'idle' })
              }}
            />
          ))}
          <button
            type="button"
            className="map-list__button"
            onClick={() => onSetMode({ kind: 'idle' })}
          >
            Cancel
          </button>
        </div>
      )

    case 'confirming-delete':
      return (
        <div className="map-list__confirm" role="alert">
          {/* No cascade to warn about: deleting a zone takes nothing with it, because no
              dialogue ever stored a reference to it. */}
          <span>
            Delete <strong>{zone.name}</strong>? Its dialogues stay where they are.
          </span>
          <button
            type="button"
            className="map-list__button map-list__button--danger"
            onClick={() => {
              dispatch({ kind: 'zone/deleted', zoneId: zone.id })
              onSetMode({ kind: 'idle' })
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="map-list__button"
            onClick={() => onSetMode({ kind: 'idle' })}
          >
            Cancel
          </button>
        </div>
      )

    case 'idle':
      return (
        <>
          <button
            type="button"
            className="zone-list__name"
            style={zoneHueStyle(zone.hue)}
            aria-current={selected ? 'true' : undefined}
            title={`Jump the canvas to ${zone.name}`}
            onClick={onFocus}
          >
            <span className="zone-list__label">{zone.name}</span>
            <span className="zone-list__count" title={`${count} dialogue${count === 1 ? '' : 's'}`}>
              {count}
            </span>
          </button>
          <button
            ref={triggerRef.rename}
            type="button"
            className="map-list__button"
            onClick={() => onSetMode({ kind: 'renaming', id: zone.id, draft: zone.name })}
          >
            Rename
          </button>
          <button
            ref={triggerRef.colour}
            type="button"
            className="map-list__button"
            onClick={() => onSetMode({ kind: 'recolouring', id: zone.id })}
          >
            Colour
          </button>
          <button
            ref={triggerRef.delete}
            type="button"
            className="map-list__button"
            onClick={() => onSetMode({ kind: 'confirming-delete', id: zone.id })}
          >
            Delete
          </button>
        </>
      )

    default:
      return assertNever(mode)
  }
}

/** Which button opened the mode this row is in — exhaustive, so a new mode must name one. */
function triggerOf(mode: ZoneListMode): RowTrigger | null {
  switch (mode.kind) {
    case 'idle':
      return null
    case 'renaming':
      return 'rename'
    case 'recolouring':
      return 'colour'
    case 'confirming-delete':
      return 'delete'
    default:
      return assertNever(mode)
  }
}

import type { ReactElement } from 'react'
import { useState } from 'react'
import { assertNever } from '../assert-never.ts'
import { dispatch } from '../project/store.ts'
import type { GameMap, ProjectFile, Zone, ZoneId } from '../project/types.ts'
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
}: {
  project: ProjectFile
  selectedId: ZoneId | null
}): ReactElement {
  const [mode, setMode] = useState<ZoneListMode>({ kind: 'idle' })

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
            zones={project.zones.filter((zone) => zone.mapId === map.id)}
            selectedId={selectedId}
            mode={mode}
            onSetMode={setMode}
            onRenameSubmit={onRenameSubmit}
          />
        ))
      )}
    </div>
  )
}

/** Renders nothing at all for a map with no zones — an empty heading is noise in a sidebar. */
function ZoneGroup({
  map,
  zones,
  selectedId,
  mode,
  onSetMode,
  onRenameSubmit,
}: {
  map: GameMap
  zones: readonly Zone[]
  selectedId: ZoneId | null
  mode: ZoneListMode
  onSetMode: (mode: ZoneListMode) => void
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
              // Only the row the mode names is in that mode; every other row stays idle.
              mode={'id' in mode && mode.id === zone.id ? mode : { kind: 'idle' }}
              onSetMode={onSetMode}
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
  mode,
  onSetMode,
  onRenameSubmit,
}: {
  zone: Zone
  selected: boolean
  mode: ZoneListMode
  onSetMode: (mode: ZoneListMode) => void
  onRenameSubmit: (draft: string) => void
}): ReactElement {
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
            onClick={() =>
              dispatch({ kind: 'selection/set', selection: { kind: 'zone', id: zone.id } })
            }
          >
            {zone.name}
          </button>
          <button
            type="button"
            className="map-list__button"
            onClick={() => onSetMode({ kind: 'renaming', id: zone.id, draft: zone.name })}
          >
            Rename
          </button>
          <button
            type="button"
            className="map-list__button"
            onClick={() => onSetMode({ kind: 'recolouring', id: zone.id })}
          >
            Colour
          </button>
          <button
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

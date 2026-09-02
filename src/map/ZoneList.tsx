import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { EditableRowDeleteConfirm, EditableRowRenameForm } from '../app/EditableRow.tsx'
import { HuePalette } from '../app/HuePalette.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import { navigate } from '../app/route.ts'
import { RowActions } from '../app/RowActions.tsx'
import { selectZone } from '../app/select.ts'
import { dispatch } from '../project/store.ts'
import type { GameMap, ProjectFile, Zone, ZoneId } from '../project/types.ts'
import { useRowFocus } from './row-focus.ts'
import { ZONE_HUES, zoneHueStyle } from './zone-style.ts'

export function ZoneList({
  project,
  selectedId,
  counts,
}: {
  project: ProjectFile
  selectedId: ZoneId | null
  counts: ReadonlyMap<ZoneId, number>
}): ReactElement {
  // One pass instead of a filter per map — O(maps x zones) matters since this re-renders every
  // frame of a zone drag.
  const orderedZones = useMemo(
    () => orderByMap(project.maps, project.zones),
    [project.maps, project.zones],
  )

  function onFocus(zone: Zone): void {
    selectZone(zone.id)
    navigate({ kind: 'canvas', dialogueId: null, focus: { kind: 'zone', id: zone.id } })
  }

  return (
    <div className="zone-list">
      {project.zones.length === 0 ? (
        <p className="zone-list__empty hint-text">
          Pick <strong>Draw zone</strong> and drag a rectangle on a map. Every dialogue pinned
          inside it counts as having happened there.
        </p>
      ) : (
        <ul className="map-list__items">
          {orderedZones.map((zone) => (
            <li key={zone.id} className="map-list__item row-actions-host">
              <ZoneRow
                zone={zone}
                selected={zone.id === selectedId}
                count={counts.get(zone.id) ?? 0}
                onFocus={() => onFocus(zone)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function orderByMap(maps: readonly GameMap[], zones: readonly Zone[]): readonly Zone[] {
  const order = new Map(maps.map((map, index) => [map.id, index]))
  return [...zones].sort((a, b) => (order.get(a.mapId) ?? 0) - (order.get(b.mapId) ?? 0))
}

// Colour is its own third mode, tracked locally beside EditableRow's rename/delete state.
function ZoneRow({
  zone,
  selected,
  count,
  onFocus,
}: {
  zone: Zone
  selected: boolean
  count: number
  onFocus: () => void
}): ReactElement {
  const editable = useEditableRow()
  const [colouring, setColouring] = useState(false)
  const triggerRef = useRowFocus(colouring ? 'colour' : editable.mode === 'idle' ? null : editable.mode)

  if (editable.mode === 'rename') {
    return (
      <EditableRowRenameForm
        value={zone.name}
        label="Zone name"
        onCommit={(name) => {
          const trimmed = name.trim()
          if (trimmed !== '') dispatch({ kind: 'zone/renamed', zoneId: zone.id, name: trimmed })
        }}
        close={editable.close}
      />
    )
  }

  if (editable.mode === 'delete') {
    return (
      <EditableRowDeleteConfirm
        message={
          <>
            Delete <strong>{zone.name}</strong>? Its dialogues stay where they are.
          </>
        }
        onConfirm={() => dispatch({ kind: 'zone/deleted', zoneId: zone.id })}
        close={editable.close}
      />
    )
  }

  if (colouring) {
    return (
      <HuePalette
        swatchClassName="zone-list__swatch"
        ariaLabel={`Colour of ${zone.name}`}
        hues={ZONE_HUES}
        selectedHue={zone.hue}
        hueStyle={zoneHueStyle}
        onSelect={(hue) => {
          dispatch({ kind: 'zone/hue-set', zoneId: zone.id, hue })
          setColouring(false)
        }}
        onCancel={() => setColouring(false)}
      />
    )
  }

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
        <span className="zone-list__count hint-text" title={`${count} dialogue${count === 1 ? '' : 's'}`}>
          {count}
        </span>
      </button>
      <RowActions>
        <button ref={triggerRef.rename} type="button" className="button" onClick={editable.openRename}>
          Rename
        </button>
        <button ref={triggerRef.colour} type="button" className="button" onClick={() => setColouring(true)}>
          Colour
        </button>
        <button ref={triggerRef.delete} type="button" className="button" onClick={editable.openDelete}>
          Delete
        </button>
      </RowActions>
    </>
  )
}

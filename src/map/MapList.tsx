import type { ReactElement } from 'react'
import { EditableRowDeleteConfirm, EditableRowRenameForm } from '../app/EditableRow.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import { navigate } from '../app/route.ts'
import { RowActions } from '../app/RowActions.tsx'
import { selectMap } from '../app/select.ts'
import { dispatch } from '../project/store.ts'
import type { GameMap, MapId, ProjectFile } from '../project/types.ts'
import { discardMediaFile } from '../media/discard-media.ts'
import { MapImportButton } from './MapImportButton.tsx'
import { useRowFocus } from './row-focus.ts'

export function MapList({ project }: { project: ProjectFile }): ReactElement {
  function onFocus(map: GameMap): void {
    selectMap(map.id)
    navigate({ kind: 'canvas', dialogueId: null, focus: { kind: 'map', id: map.id } })
  }

  async function onDeleteConfirmed(map: GameMap): Promise<void> {
    // Collected before the dispatch — the cascade removes the very dialogues that name the files.
    const orphanedFiles = mediaFileNamesOf(project, map.id)

    dispatch({ kind: 'map/deleted', mapId: map.id })
    await Promise.all(orphanedFiles.map(discardMediaFile))
  }

  return (
    <div className="map-list">
      <h2 className="map-list__heading micro-label">Maps</h2>
      <ul className="map-list__items">
        {project.maps.map((map) => (
          <li key={map.id} className="map-list__item row-actions-host">
            <MapRow
              project={project}
              map={map}
              onFocus={() => onFocus(map)}
              onDeleteConfirmed={() => onDeleteConfirmed(map)}
            />
          </li>
        ))}
      </ul>
      <MapImportButton label="Import map" />
    </div>
  )
}

function MapRow({
  project,
  map,
  onFocus,
  onDeleteConfirmed,
}: {
  project: ProjectFile
  map: GameMap
  onFocus: () => void
  onDeleteConfirmed: () => void
}): ReactElement {
  const editable = useEditableRow()
  const triggerRef = useRowFocus(editable.mode === 'idle' ? null : editable.mode)

  if (editable.mode === 'rename') {
    return (
      <EditableRowRenameForm
        value={map.name}
        label="Map name"
        onCommit={(name) => {
          const trimmed = name.trim()
          if (trimmed !== '') dispatch({ kind: 'map/renamed', mapId: map.id, name: trimmed })
        }}
        close={editable.close}
      />
    )
  }

  if (editable.mode === 'delete') {
    const counts = cascadeCounts(project, map.id)
    return (
      <EditableRowDeleteConfirm
        message={
          <>
            Delete <strong>{map.name}</strong> with {counts.dialogues} dialogue
            {counts.dialogues === 1 ? '' : 's'} and {counts.zones} zone
            {counts.zones === 1 ? '' : 's'}?
          </>
        }
        onConfirm={onDeleteConfirmed}
        close={editable.close}
      />
    )
  }

  return (
    <>
      <button
        type="button"
        className="map-list__name"
        title={`Jump the canvas to ${map.name}`}
        onClick={onFocus}
      >
        {map.name}
      </button>
      <RowActions>
        <button ref={triggerRef.rename} type="button" className="button" onClick={editable.openRename}>
          Rename
        </button>
        <button ref={triggerRef.delete} type="button" className="button" onClick={editable.openDelete}>
          Delete
        </button>
      </RowActions>
    </>
  )
}

function cascadeCounts(project: ProjectFile, mapId: MapId): { dialogues: number; zones: number } {
  return {
    dialogues: project.dialogues.filter((dialogue) => dialogue.mapId === mapId).length,
    zones: project.zones.filter((zone) => zone.mapId === mapId).length,
  }
}

function mediaFileNamesOf(project: ProjectFile, mapId: MapId): string[] {
  const map = project.maps.find((candidate) => candidate.id === mapId)
  const names = map === undefined ? [] : [map.file.fileName]
  for (const dialogue of project.dialogues) {
    if (dialogue.mapId !== mapId) continue
    for (const medium of dialogue.media) names.push(medium.file.fileName)
  }
  return names
}

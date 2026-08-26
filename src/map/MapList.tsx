import type { ReactElement } from 'react'
import { useState } from 'react'
import { navigate } from '../app/route.ts'
import { RowActions } from '../app/RowActions.tsx'
import { selectMap } from '../app/select.ts'
import { assertNever } from '../assert-never.ts'
import { dispatch } from '../project/store.ts'
import type { GameMap, MapId, ProjectFile } from '../project/types.ts'
import { discardMediaFile } from '../media/discard-media.ts'
import { MapImportButton } from './MapImportButton.tsx'
import type { RowTrigger } from './row-focus.ts'
import { useRowFocus } from './row-focus.ts'

/**
 * Transient list UI — the rename draft and the delete confirmation — is component state,
 * never the store. See CLAUDE.md § Store scope. One mode for the whole list rather than one
 * per row, because only one row can be mid-edit at a time.
 */
type ListMode =
  | { kind: 'idle' }
  | { kind: 'renaming'; id: MapId; draft: string }
  | { kind: 'confirming-delete'; id: MapId }

/**
 * Every map in the project, as a list. On a shared canvas its job is navigation, naming, and
 * deletion — there is no active map to pick, so this is not a picker.
 */
export function MapList({ project }: { project: ProjectFile }): ReactElement {
  const [mode, setMode] = useState<ListMode>({ kind: 'idle' })

  /** Focus is carried in the hash so the jump is one navigation, not a second channel. */
  function onFocus(map: GameMap): void {
    selectMap(map.id)
    navigate({ kind: 'canvas', dialogueId: null, focus: { kind: 'map', id: map.id } })
  }

  function onRenameSubmit(id: MapId, draft: string): void {
    const name = draft.trim()
    if (name !== '') dispatch({ kind: 'map/renamed', mapId: id, name })
    setMode({ kind: 'idle' })
  }

  async function onDeleteConfirmed(map: GameMap): Promise<void> {
    // File names are collected *before* the dispatch, because the cascade removes the very
    // dialogues that name the files — afterwards nothing would say what to clean up.
    const orphanedFiles = mediaFileNamesOf(project, map.id)

    dispatch({ kind: 'map/deleted', mapId: map.id })
    setMode({ kind: 'idle' })

    // `discardMediaFile` never rejects — the document is already correct, so a file that
    // resists deletion is dead weight in media/, not a broken project.
    await Promise.all(orphanedFiles.map(discardMediaFile))
  }

  return (
    <div className="map-list">
      <h2 className="map-list__heading">Maps</h2>
      <ul className="map-list__items">
        {project.maps.map((map) => (
          <li key={map.id} className="map-list__item row-actions-host">
            <MapRow
              project={project}
              map={map}
              // Only the row the mode names is in that mode; every other row stays idle.
              mode={'id' in mode && mode.id === map.id ? mode : { kind: 'idle' }}
              onSetMode={setMode}
              onFocus={() => onFocus(map)}
              onRenameSubmit={(draft) => onRenameSubmit(map.id, draft)}
              onDeleteConfirmed={() => void onDeleteConfirmed(map)}
            />
          </li>
        ))}
      </ul>
      <MapImportButton label="Import map" />
    </div>
  )
}

/** Exhaustive over `ListMode`; the `ReactElement` return type rejects a silently added one. */
function MapRow({
  project,
  map,
  mode,
  onSetMode,
  onFocus,
  onRenameSubmit,
  onDeleteConfirmed,
}: {
  project: ProjectFile
  map: GameMap
  mode: ListMode
  onSetMode: (mode: ListMode) => void
  onFocus: () => void
  onRenameSubmit: (draft: string) => void
  onDeleteConfirmed: () => void
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
            aria-label="Map name"
            onChange={(event) =>
              onSetMode({ kind: 'renaming', id: map.id, draft: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape') onSetMode({ kind: 'idle' })
            }}
          />
          <button type="submit" className="button">
            Save
          </button>
          <button
            type="button"
            className="button"
            onClick={() => onSetMode({ kind: 'idle' })}
          >
            Cancel
          </button>
        </form>
      )

    case 'confirming-delete': {
      const counts = cascadeCounts(project, map.id)
      return (
        <div className="map-list__confirm" role="alert">
          <span>
            Delete <strong>{map.name}</strong> with {counts.dialogues} dialogue
            {counts.dialogues === 1 ? '' : 's'} and {counts.zones} zone
            {counts.zones === 1 ? '' : 's'}?
          </span>
          <button
            type="button"
            className="button button--danger"
            onClick={onDeleteConfirmed}
          >
            Delete
          </button>
          <button
            type="button"
            className="button"
            onClick={() => onSetMode({ kind: 'idle' })}
          >
            Cancel
          </button>
        </div>
      )
    }

    case 'idle':
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
            <button
              ref={triggerRef.rename}
              type="button"
              className="button"
              onClick={() => onSetMode({ kind: 'renaming', id: map.id, draft: map.name })}
            >
              Rename
            </button>
            <button
              ref={triggerRef.delete}
              type="button"
              className="button"
              onClick={() => onSetMode({ kind: 'confirming-delete', id: map.id })}
            >
              Delete
            </button>
          </RowActions>
        </>
      )

    default:
      return assertNever(mode)
  }
}

/** Which button opened the mode this row is in — exhaustive, so a new mode must name one. */
function triggerOf(mode: ListMode): RowTrigger | null {
  switch (mode.kind) {
    case 'idle':
      return null
    case 'renaming':
      return 'rename'
    case 'confirming-delete':
      return 'delete'
    default:
      return assertNever(mode)
  }
}

function cascadeCounts(project: ProjectFile, mapId: MapId): { dialogues: number; zones: number } {
  return {
    dialogues: project.dialogues.filter((dialogue) => dialogue.mapId === mapId).length,
    zones: project.zones.filter((zone) => zone.mapId === mapId).length,
  }
}

/** Every file in `media/` that deleting this map would otherwise orphan. */
function mediaFileNamesOf(project: ProjectFile, mapId: MapId): string[] {
  const map = project.maps.find((candidate) => candidate.id === mapId)
  const names = map === undefined ? [] : [map.file.fileName]
  for (const dialogue of project.dialogues) {
    if (dialogue.mapId !== mapId) continue
    for (const medium of dialogue.media) names.push(medium.file.fileName)
  }
  return names
}

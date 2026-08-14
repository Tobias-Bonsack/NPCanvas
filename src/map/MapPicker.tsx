import type { ChangeEvent, ReactElement } from 'react'
import { useId, useState } from 'react'
import { navigate } from '../app/route.ts'
import { importMapImage } from '../media/import-media.ts'
import { dispatch } from '../project/store.ts'
import type { GameMap, MapId, ProjectFile } from '../project/types.ts'
import { deleteMediaFile, describeError } from '../storage/project-directory.ts'
import { nextMapOrigin } from './canvas-layout.ts'

/**
 * Transient picker UI — the rename draft and the delete confirmation — is component state,
 * never the store. See CLAUDE.md § Store scope.
 */
type PickerMode =
  | { kind: 'idle' }
  | { kind: 'renaming'; draft: string }
  | { kind: 'confirming-delete' }

export function MapPicker({
  project,
  activeMap,
}: {
  project: ProjectFile
  activeMap: GameMap
}): ReactElement {
  const [mode, setMode] = useState<PickerMode>({ kind: 'idle' })
  const selectId = useId()

  function onSwitchMap(event: ChangeEvent<HTMLSelectElement>): void {
    navigate({ kind: 'map', mapId: asExistingMapId(project, event.target.value), dialogueId: null })
  }

  function onRenameSubmit(draft: string): void {
    const name = draft.trim()
    if (name !== '') dispatch({ kind: 'map/renamed', mapId: activeMap.id, name })
    setMode({ kind: 'idle' })
  }

  async function onDeleteConfirmed(): Promise<void> {
    // File names are collected *before* the dispatch, because the cascade removes the very
    // dialogues that name the files — afterwards nothing would say what to clean up.
    const orphanedFiles = mediaFileNamesOf(project, activeMap.id)
    const remaining = project.maps.filter((other) => other.id !== activeMap.id)

    dispatch({ kind: 'map/deleted', mapId: activeMap.id })
    setMode({ kind: 'idle' })
    navigate(
      { kind: 'map', mapId: remaining.length === 0 ? null : remaining[0].id, dialogueId: null },
      { replace: true },
    )

    // The document is already correct, so a file that resists deletion is dead weight in
    // media/, not a broken project. Reported, not surfaced as app state.
    const results = await Promise.allSettled(orphanedFiles.map(deleteMediaFile))
    for (const result of results) {
      if (result.status === 'rejected') console.error('Could not delete media file', result.reason)
    }
  }

  if (mode.kind === 'renaming') {
    return (
      <form
        className="map-picker"
        onSubmit={(event) => {
          event.preventDefault()
          onRenameSubmit(mode.draft)
        }}
      >
        <input
          className="map-picker__input"
          value={mode.draft}
          autoFocus
          aria-label="Map name"
          onChange={(event) => setMode({ kind: 'renaming', draft: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMode({ kind: 'idle' })
          }}
        />
        <button type="submit" className="map-picker__button">
          Save
        </button>
        <button type="button" className="map-picker__button" onClick={() => setMode({ kind: 'idle' })}>
          Cancel
        </button>
      </form>
    )
  }

  if (mode.kind === 'confirming-delete') {
    const counts = cascadeCounts(project, activeMap.id)
    return (
      <div className="map-picker" role="alert">
        <span className="map-picker__confirm">
          Delete <strong>{activeMap.name}</strong> with {counts.dialogues} dialogue
          {counts.dialogues === 1 ? '' : 's'} and {counts.zones} zone
          {counts.zones === 1 ? '' : 's'}?
        </span>
        <button
          type="button"
          className="map-picker__button map-picker__button--danger"
          onClick={() => void onDeleteConfirmed()}
        >
          Delete
        </button>
        <button type="button" className="map-picker__button" onClick={() => setMode({ kind: 'idle' })}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="map-picker">
      <label className="map-picker__label" htmlFor={selectId}>
        Map
      </label>
      <select id={selectId} className="map-picker__select" value={activeMap.id} onChange={onSwitchMap}>
        {project.maps.map((map) => (
          <option key={map.id} value={map.id}>
            {map.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="map-picker__button"
        onClick={() => setMode({ kind: 'renaming', draft: activeMap.name })}
      >
        Rename
      </button>
      <button
        type="button"
        className="map-picker__button"
        onClick={() => setMode({ kind: 'confirming-delete' })}
      >
        Delete
      </button>
      <MapImportButton label="Import map" maps={project.maps} />
    </div>
  )
}

/**
 * The only import path in the app, used both in the picker bar and in the empty-project call
 * to action — hence a shared leaf rather than the same file input written out twice.
 */
export function MapImportButton({
  label,
  maps,
}: {
  label: string
  /** Only to place the new map beside the existing ones — see `nextMapOrigin`. */
  maps: readonly GameMap[]
}): ReactElement {
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  async function onFilePicked(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.target
    const file = input.files?.[0]
    // Clearing the input is what lets the same file be picked twice in a row — otherwise
    // the second pick is not a change and fires no event at all.
    input.value = ''
    if (file === undefined) return

    setError(null)
    setImporting(true)
    try {
      const map = await importMapImage(file, nextMapOrigin(maps))
      dispatch({ kind: 'map/added', map })
      navigate({ kind: 'map', mapId: map.id, dialogueId: null })
    } catch (importError) {
      setError(describeError(importError))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="map-import">
      {/* A styled `<label>` driving a visually-hidden input: `<input type="file">` cannot be
          restyled, and a button would need a ref plus a synthetic click to reach it. */}
      <label className="map-import__label" htmlFor={inputId} aria-disabled={importing}>
        {importing ? 'Importing…' : label}
      </label>
      <input
        id={inputId}
        className="map-import__input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        disabled={importing}
        onChange={(event) => void onFilePicked(event)}
      />
      {error !== null && (
        <p className="map-import__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
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
    if (dialogue.content.kind !== 'text') names.push(dialogue.content.file.fileName)
  }
  return names
}

/** The `<select>` value is a raw string; only one that names a real map may be routed to. */
function asExistingMapId(project: ProjectFile, value: string): MapId | null {
  return project.maps.find((map) => map.id === value)?.id ?? null
}

import type { ChangeEvent, ReactElement } from 'react'
import { useId, useState } from 'react'
import { MAP_IMAGE_ACCEPT, importMapImage } from '../media/import-media.ts'
import { dispatch, getState } from '../project/store.ts'
import type { GameMap } from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { nextMapOrigin } from './canvas-layout.ts'

/**
 * The only import path in the app, used both in the map list and in the empty-project call
 * to action, hence a shared leaf rather than the same file input written out twice.
 */
export function MapImportButton({ label }: { label: string }): ReactElement {
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
      const imported = await importMapImage(file)
      // Placed against the maps as they are *now*, which is the whole reason `nextMapOrigin`
      // exists: two imports started a moment apart would otherwise both be placed against the
      // array as it was before either landed, and end up stacked on the same origin.
      //
      // No navigation and no viewport change: the new map appears beside the others, and
      // yanking the view to it would lose wherever the user was working.
      dispatch({ kind: 'map/added', map: { ...imported, origin: nextMapOrigin(currentMaps()) } })
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
      <label
        className="button--primary map-import__label"
        htmlFor={inputId}
        data-importing={importing ? 'true' : undefined}
      >
        {importing ? 'Importing…' : label}
      </label>
      <input
        id={inputId}
        className="visually-hidden map-import__input"
        type="file"
        accept={MAP_IMAGE_ACCEPT}
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

/** Read at dispatch time, never taken as a prop: a prop is the render the file was picked in. */
function currentMaps(): readonly GameMap[] {
  const state = getState()
  return state.kind === 'ready' ? state.project.maps : []
}

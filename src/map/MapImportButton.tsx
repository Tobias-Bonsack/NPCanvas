import type { ChangeEvent, ReactElement } from 'react'
import { useId, useState } from 'react'
import { MAP_IMAGE_ACCEPT, importMapImage } from '../media/import-media.ts'
import { dispatch, getState } from '../project/store.ts'
import type { GameMap } from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { nextMapOrigin } from './canvas-layout.ts'

export function MapImportButton({ label }: { label: string }): ReactElement {
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  async function onFilePicked(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.target
    const file = input.files?.[0]
    input.value = '' // else picking the same file twice in a row fires no change event
    if (file === undefined) return

    setError(null)
    setImporting(true)
    try {
      const imported = await importMapImage(file)
      // currentMaps() reads state at dispatch time so two imports a moment apart don't both
      // place against the same stale array and stack on one origin.
      dispatch({ kind: 'map/added', map: { ...imported, origin: nextMapOrigin(currentMaps()) } })
    } catch (importError) {
      setError(describeError(importError))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="map-import">
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

function currentMaps(): readonly GameMap[] {
  const state = getState()
  return state.kind === 'ready' ? state.project.maps : []
}

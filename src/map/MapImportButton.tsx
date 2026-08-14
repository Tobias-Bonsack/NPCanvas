import type { ChangeEvent, ReactElement } from 'react'
import { useId, useState } from 'react'
import { importMapImage } from '../media/import-media.ts'
import { dispatch } from '../project/store.ts'
import type { GameMap } from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'
import { nextMapOrigin } from './canvas-layout.ts'

/**
 * The only import path in the app, used both in the map list and in the empty-project call
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
      // No navigation and no viewport change: the new map appears beside the others, and
      // yanking the view to it would lose wherever the user was working.
      dispatch({ kind: 'map/added', map: await importMapImage(file, nextMapOrigin(maps)) })
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

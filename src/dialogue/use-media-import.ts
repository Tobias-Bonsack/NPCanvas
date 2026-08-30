import { useEffect, useState } from 'react'
import { discardMediaFile } from '../media/discard-media.ts'
import { importDialogueMedia } from '../media/import-media.ts'
import { currentDialogue, dispatch } from '../project/store.ts'
import type { DialogueId } from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'

// Component state, not the store's — an import in flight and a size warning are UI, not
// properties of the document.
export type ImportState =
  | { kind: 'idle' }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'warned'; message: string }
  | { kind: 'failed'; message: string }

export function importingLabel(done: number, total: number): string {
  return total === 1 ? 'Importing…' : `Importing ${done + 1} of ${total}…`
}

// A failure outranks a size warning — the panel has one message to give.
export function batchOutcome(
  total: number,
  failures: readonly string[],
  warnings: readonly string[],
): ImportState {
  if (failures.length > 0) {
    const imported = total - failures.length
    const prefix = imported === 0 ? '' : `${imported} of ${total} imported. `
    return { kind: 'failed', message: `${prefix}${failures.join(' ')}` }
  }
  if (warnings.length > 0) return { kind: 'warned', message: warnings.join(' ') }
  return { kind: 'idle' }
}

type MediaImportApi = {
  importState: ImportState
  // One file after the next, not in parallel — list order is drop order, and a failing file is
  // named and skipped rather than abandoning the rest of the batch.
  importFiles: (files: readonly File[]) => Promise<void>
  resetImport: () => void
}

export function useMediaImport(dialogueId: DialogueId): MediaImportApi {
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })

  useEffect(() => {
    setImportState({ kind: 'idle' })
  }, [dialogueId])

  async function importFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0) return
    const failures: string[] = []
    const warnings: string[] = []
    // Files this batch already wrote — needed to clean up if the dialogue is deleted mid-import.
    const written: string[] = []

    for (const [index, file] of files.entries()) {
      setImportState({ kind: 'importing', done: index, total: files.length })
      try {
        const { media, warning } = await importDialogueMedia(dialogueId, file)
        written.push(media.file.fileName)
        dispatch({ kind: 'dialogue/media-added', dialogueId, media })
        if (warning !== null) warnings.push(`${file.name}: ${warning}`)
      } catch (error) {
        failures.push(`${file.name}: ${describeError(error)}`)
      }
      // The dispatch above is a silent no-op once the dialogue is gone (deleted, or cascaded
      // away with its map) — without this check the panel would report success for nothing.
      if (currentDialogue(dialogueId) === null) {
        for (const fileName of written) await discardMediaFile(fileName)
        setImportState({
          kind: 'failed',
          message: 'The dialogue was deleted while importing. Nothing was kept.',
        })
        return
      }
    }

    setImportState(batchOutcome(files.length, failures, warnings))
  }

  return { importState, importFiles, resetImport: () => setImportState({ kind: 'idle' }) }
}

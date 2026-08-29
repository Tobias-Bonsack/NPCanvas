import { useEffect, useState } from 'react'
import { discardMediaFile } from '../media/discard-media.ts'
import { importDialogueMedia } from '../media/import-media.ts'
import { currentDialogue, dispatch } from '../project/store.ts'
import type { DialogueId } from '../project/types.ts'
import { describeError } from '../storage/project-directory.ts'

/**
 * The panel's own transient state for a multi-file media import. Not the store's: an import in
 * flight is UI, and a warning about a large file is advice about one interaction, not a property
 * of the document.
 */
export type ImportState =
  | { kind: 'idle' }
  /** `done` files of `total` are already in the document — a batch reports where it is. */
  | { kind: 'importing'; done: number; total: number }
  /** The import succeeded; the message is advice, not an error. */
  | { kind: 'warned'; message: string }
  | { kind: 'failed'; message: string }

/** Silent about the count for a single file, so the common case reads as it always did. */
export function importingLabel(done: number, total: number): string {
  return total === 1 ? 'Importing…' : `Importing ${done + 1} of ${total}…`
}

/**
 * What a finished batch leaves on screen. A failure outranks a size warning: the warning is
 * advice about a file that *did* import, and the panel has one message to give.
 */
export function batchOutcome(
  total: number,
  failures: readonly string[],
  warnings: readonly string[],
): ImportState {
  if (failures.length > 0) {
    const imported = total - failures.length
    // Named counts, because "one of these five was rejected" is invisible in a list that
    // simply came out shorter than the drop.
    const prefix = imported === 0 ? '' : `${imported} of ${total} imported. `
    return { kind: 'failed', message: `${prefix}${failures.join(' ')}` }
  }
  if (warnings.length > 0) return { kind: 'warned', message: warnings.join(' ') }
  return { kind: 'idle' }
}

type MediaImportApi = {
  importState: ImportState
  /**
   * One file after the next rather than in parallel: the list order *is* the drop order, and
   * concurrent probes would append in whatever order the decoder finished in. A file that fails
   * is named and skipped — abandoning the rest of a five-frame drop because frame three was a
   * PDF would lose four good pictures.
   */
  importFiles: (files: readonly File[]) => Promise<void>
  /** Cleared after a medium is removed, so a stale warning or error does not outlive it. */
  resetImport: () => void
}

/**
 * The panel's media-import flow: several dropped or picked files, reported one at a time, with
 * per-file failure named rather than abandoning the rest of the batch.
 */
export function useMediaImport(dialogueId: DialogueId): MediaImportApi {
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })

  // A warning or an error belongs to the import that produced it, and would otherwise hang over
  // whichever dialogue the user selected next.
  useEffect(() => {
    setImportState({ kind: 'idle' })
  }, [dialogueId])

  async function importFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0) return
    const failures: string[] = []
    const warnings: string[] = []
    // Every file this batch has already put in media/. Nothing else would name them again if
    // the dialogue is deleted mid-import, and the cascade that deleted it only knew about the
    // media the document held at the time.
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
      // The dispatch above is a no-op once the dialogue is gone: deleted from the canvas, or
      // cascaded away with its map, while "Importing..." was up. The reducer returning the same
      // state is silent, so without this check the panel reports success for a document that
      // never took the media, and the files sit in media/ forever, invisible from inside the app.
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

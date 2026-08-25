import type { DialogueMedia } from '../project/types.ts'
import { deleteMediaFile } from '../storage/project-directory.ts'
import { invalidateMediaFile } from './media-url-cache.ts'

/**
 * Removes a file from `media/` and drops its cache entry — the only way anything deletes media.
 *
 * The two halves are one operation and never appear apart: the cache is keyed on the file name
 * alone, so an entry that outlives its file serves deleted bytes to the next import that lands
 * on that name, and to any reader still mounted. Invalidating *after* the delete is what makes
 * such a reader re-read and find it missing rather than find it again.
 *
 * Never rejects. Every caller reaches here having already removed the last reference to the
 * file from the document, so a file that resists deletion is dead weight in `media/`, not a
 * broken project — reported to the console, never surfaced as app state.
 */
export async function discardMediaFile(fileName: string): Promise<void> {
  try {
    await deleteMediaFile(fileName)
  } catch (error) {
    console.error('Could not delete media file', error)
  }
  invalidateMediaFile(fileName)
}

/**
 * Every file a `Dialogue` or a `PendingCapture` owns, discarded in order. Deleting either record
 * cascades its media the same way — nothing names the files once the record is gone, and an
 * orphan in `media/` is invisible from inside the app. Callers still collect the list *before*
 * dispatching the delete, since the record naming the files is what the dispatch removes.
 */
export async function discardMedia(media: readonly DialogueMedia[]): Promise<void> {
  for (const medium of media) await discardMediaFile(medium.file.fileName)
}

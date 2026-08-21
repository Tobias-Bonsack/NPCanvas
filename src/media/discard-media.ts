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

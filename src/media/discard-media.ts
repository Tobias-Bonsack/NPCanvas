import type { DialogueMedia } from '../project/types.ts'
import { deleteMediaFile } from '../storage/project-directory.ts'
import { invalidateMediaFile } from './media-url-cache.ts'

// The only way anything deletes media. Invalidates the cache after the delete, so a reader
// still mounted re-reads and finds it missing rather than finds it again. Never rejects — a
// file that resists deletion is dead weight in media/, not a broken project.
export async function discardMediaFile(fileName: string): Promise<void> {
  try {
    await deleteMediaFile(fileName)
  } catch (error) {
    console.error('Could not delete media file', error)
  }
  invalidateMediaFile(fileName)
}

// Callers collect the list before dispatching the delete, since the record naming the files
// is what the dispatch removes.
export async function discardMedia(media: readonly DialogueMedia[]): Promise<void> {
  for (const medium of media) await discardMediaFile(medium.file.fileName)
}

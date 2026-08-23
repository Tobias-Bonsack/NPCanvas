import type { DialogueMedia, MediaId } from '../project/types.ts'

/**
 * Which frame a gallery is showing, resolved from the id it was told to show rather than from
 * an index it was told to remember. The distinction is the whole point: a `MediaId` is what a
 * remove or a reorder addresses (see CLAUDE.md's media contract), so moving the current frame
 * one step later keeps *that frame* on screen instead of whatever slid into its old position.
 *
 * An id that is no longer in the list falls to the last frame — the list only ever loses the
 * one that was just removed, and the frame after it has by then taken its index, except at the
 * end, where there is nothing after it.
 */
export function resolveGalleryIndex(
  media: readonly DialogueMedia[],
  selectedId: MediaId | null,
): number {
  if (media.length === 0 || selectedId === null) return 0
  const index = media.findIndex((medium) => medium.id === selectedId)
  return index === -1 ? media.length - 1 : index
}

/**
 * Paging, clamped rather than wrapped. Past the last frame is the last frame: the frames are a
 * sequence of one thing said, and wrapping from the end to the beginning reads as a new line
 * having appeared.
 */
export function stepGalleryIndex(index: number, delta: number, length: number): number {
  if (length === 0) return 0
  return Math.min(Math.max(index + delta, 0), length - 1)
}

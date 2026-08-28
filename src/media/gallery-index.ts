/**
 * Which item a gallery is showing, resolved from the id it was told to show rather than from an
 * index it was told to remember — for any list of items with an id, not only `DialogueMedia`'s
 * `MediaId`. The distinction is the whole point: an id is what a remove or a reorder (or, for a
 * `PendingCaptureId`, a placement) addresses, so moving the current item one step later keeps
 * *that item* on screen instead of whatever slid into its old position.
 *
 * An id that is no longer in the list falls to the last item — the list only ever loses the one
 * that was just removed, and the item after it has by then taken its index, except at the end,
 * where there is nothing after it. This is also exactly the case of a capture leaving
 * `pendingCaptures` because it was placed or deleted (#108).
 *
 * Paging itself (`stepGalleryIndex`) needs no id at all — it clamps a plain index — so it stays
 * ungeneric below.
 */
export function resolveGalleryIndex<Id extends string, T extends { id: Id }>(
  items: readonly T[],
  selectedId: Id | null,
): number {
  if (items.length === 0 || selectedId === null) return 0
  const index = items.findIndex((item) => item.id === selectedId)
  return index === -1 ? items.length - 1 : index
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

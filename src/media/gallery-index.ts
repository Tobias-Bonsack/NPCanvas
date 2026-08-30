// Resolved from the id a gallery was told to show, not an index it was told to remember, so a
// reorder keeps that item on screen instead of whatever slid into its old position. An id no
// longer in the list falls to the last item.
export function resolveGalleryIndex<Id extends string, T extends { id: Id }>(
  items: readonly T[],
  selectedId: Id | null,
): number {
  if (items.length === 0 || selectedId === null) return 0
  const index = items.findIndex((item) => item.id === selectedId)
  return index === -1 ? items.length - 1 : index
}

// Clamped, not wrapped — wrapping from end to beginning would read as a new line appearing.
export function stepGalleryIndex(index: number, delta: number, length: number): number {
  if (length === 0) return 0
  return Math.min(Math.max(index + delta, 0), length - 1)
}

/**
 * Which buttons transitioned from released to pressed between two polls of a gamepad's button
 * state, as indices into `current`. Pure and importing nothing, so a binding row's "listen for
 * the next press" and `gamepad-watch.ts`'s own poll can share one rule with no browser API
 * between them and this file's tests.
 *
 * A `previous` of length **zero** is read as "no reading yet" rather than "every button was
 * released" — the very first poll after a pad connects has nothing to compare against, and
 * reading it as all-released would fire the trigger for every button the player happened to
 * already be resting a finger on. A later poll whose snapshots simply differ in length — a pad
 * swapped mid-session for one with a different button count — is not that case: a missing index
 * in either array is read as "not pressed" there, never as "no reading at all".
 */
export function pressedEdges(previous: readonly boolean[], current: readonly boolean[]): number[] {
  if (previous.length === 0) return []
  const edges: number[] = []
  current.forEach((pressed, index) => {
    if (pressed && !(previous[index] ?? false)) edges.push(index)
  })
  return edges
}

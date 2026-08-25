// A box in the middle of a scrolling run often shows nothing of its own.
//
// The text box is a sliding window over a longer text. Every window the watcher writes brought at
// least one new line with it — that is what `appendOutcome` checked before the picture was taken —
// but by the time the *next* window has been written, the one before it can lie entirely under its
// two neighbours: its front half is the tail of the earlier box, its back half the head of the
// later one. Such a frame costs a file and a row in the media list and proves nothing the frames
// around it do not already prove, so the watcher takes it back.
//
// Pure, and its own module because the judgement below is the whole of it.

/**
 * Whether `middle` says nothing that `before` and `after` do not say between them.
 *
 * True when `middle` can be cut at one point so that the front is a suffix of `before` and the back
 * is a prefix of `after` — the scroll, stated exactly. `before === ''` is the case where the box
 * *fills* instead of scrolling: no cut is possible except at zero, so it asks whether `middle` is
 * wholly the beginning of `after`, which is the right question for a window that only grew.
 *
 * Compared as words with punctuation trimmed off their ends, not character by character. That is
 * load-bearing rather than lenient: a comma the middle box showed at the end of its first line is
 * gone from the later box, which starts on the word after it — an exact comparison would keep every
 * frame whose cut happens to fall on punctuation, which is most of them.
 */
export function middleAddsNothing(before: string, middle: string, after: string): boolean {
  const front = words(before)
  const body = words(middle)
  const back = words(after)

  for (let cut = 0; cut <= body.length; cut++) {
    if (endsWith(front, body.slice(0, cut)) && startsWith(back, body.slice(cut))) return true
  }
  return false
}

/** Whitespace-separated, with punctuation trimmed off both ends. Empty tokens are not words. */
function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token !== '')
}

function endsWith(list: readonly string[], tail: readonly string[]): boolean {
  if (tail.length > list.length) return false
  const offset = list.length - tail.length
  return tail.every((word, index) => list[offset + index] === word)
}

function startsWith(list: readonly string[], head: readonly string[]): boolean {
  if (head.length > list.length) return false
  return head.every((word, index) => list[index] === word)
}

// The text box is a sliding window over a longer text, so a frame between two others can lie
// entirely under them: its front half the tail of the earlier box, its back half the head of the
// later one, proving nothing they don't already.

// True when `middle` can be cut at one point so the front is a suffix of `before` and the back a
// prefix of `after` (`before === ''` asks whether `middle` is wholly the start of `after`, for a
// box that filled rather than scrolled). Compared as words with punctuation trimmed, not
// character by character — a comma the middle box shows at a line end is gone from the box after
// it, so an exact comparison would keep almost every frame.
export function middleAddsNothing(before: string, middle: string, after: string): boolean {
  const front = words(before)
  const body = words(middle)
  const back = words(after)

  for (let cut = 0; cut <= body.length; cut++) {
    if (endsWith(front, body.slice(0, cut)) && startsWith(back, body.slice(cut))) return true
  }
  return false
}

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

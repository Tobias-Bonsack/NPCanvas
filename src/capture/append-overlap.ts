// Two captures of the same scrolling text box overlap by whatever stayed on screen.
//
// A Game Boy text box holds two lines and scrolls one line at a time, so pressing A between two
// captures leaves the second transcript starting on the line the first one ended on. Appending it
// whole duplicates that line; appending nothing loses the new one. What is new is everything after
// the longest suffix of the existing text that the incoming text begins with.
//
// Pure, and its own module because the cases below are what make it correct — the loop is four
// lines and the judgement around it is the rest.

/**
 * The shortest suffix/prefix match that counts as a scroll rather than a coincidence.
 *
 * A line ending in `n` and a line starting with `n` overlap by one character and mean nothing;
 * treating that as a scroll would silently swallow a character of new text. Four sits below any
 * real repeat — a scrolled line is up to eighteen tiles, and at its shortest a whole word like
 * `YES.` — and above the alignments that happen by chance.
 */
export const MIN_OVERLAP = 4

/**
 * The existing text with only the genuinely new part of `incoming` appended.
 *
 * Matching runs on whitespace-normalised copies of both sides, because #53 joins a text box's lines
 * with single spaces while a hand-edited text may hold newlines or runs of them — the same sentence
 * either way. What gets appended is the incoming text in the form it arrived in.
 *
 * Returns `existing` itself when there is nothing to add, which is the likeliest misfire: capturing
 * twice without advancing the game reads the identical frame, and that text is already there.
 */
export function appendWithoutOverlap(existing: string, incoming: string): string {
  const before = normalise(existing)
  const after = normalise(incoming)

  if (after.text === '') return existing
  if (before.text === '') return incoming
  if (before.text.includes(after.text)) return existing

  const overlap = longestOverlap(before.text, after.text)
  const remainder = incoming.slice(after.sourceIndex[overlap])
  // Whitespace at the cut is the join. A normalised text is trimmed, so an overlap always ends on a
  // non-space: text following it directly continues a word and must not be pushed apart by a space.
  const separator = overlap === 0 || /^\s/.test(remainder) ? ' ' : ''
  return existing.trimEnd() + separator + remainder.trimStart()
}

/** A normalised text, and where each of its characters started in the text it came from. */
type Normalised = {
  text: string
  /** `text.length + 1` entries — the last one is the end of the source, so every cut is indexable. */
  sourceIndex: number[]
}

/**
 * How many leading characters of `after` the end of `before` already holds, `0` for none.
 *
 * Counts down from the longest possible match so the **longest** overlap wins: a text box that
 * repeats two lines must not be joined on the first single word that happens to line up.
 */
function longestOverlap(before: string, after: string): number {
  // An incoming text shorter than the minimum can only ever overlap by less than it, so the floor
  // drops to one rather than rejecting every match a two-character reply could make.
  const minimum = after.length < MIN_OVERLAP ? 1 : MIN_OVERLAP
  for (let length = Math.min(before.length, after.length); length >= minimum; length--) {
    if (before.endsWith(after.slice(0, length))) return length
  }
  return 0
}

/** Trimmed, with every run of whitespace collapsed to one space — a run's index is its first char. */
function normalise(raw: string): Normalised {
  let text = ''
  const sourceIndex: number[] = []
  let spaceStart = -1

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (/\s/.test(char)) {
      if (text !== '' && spaceStart === -1) spaceStart = index
      continue
    }
    if (spaceStart !== -1) {
      text += ' '
      sourceIndex.push(spaceStart)
      spaceStart = -1
    }
    text += char
    sourceIndex.push(index)
  }

  sourceIndex.push(raw.length)
  return { text, sourceIndex }
}

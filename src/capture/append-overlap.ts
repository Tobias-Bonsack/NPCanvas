// A Game Boy text box holds two lines and scrolls one at a time, so the second of two captures
// starts on the line the first one ended on. What is new is everything after the longest suffix of
// the existing text that the incoming text begins with.

// A line ending in `n` and a line starting with `n` overlap by one character and mean nothing; 4
// sits below any real repeat (a scrolled line is up to 18 tiles) and above chance alignments.
export const MIN_OVERLAP = 4

// Matched on whitespace-normalised copies of both sides — the transcript joins lines with single
// spaces, while a hand-edited text may hold newlines. Returns `existing` itself when there is
// nothing new to add.
export function appendWithoutOverlap(existing: string, incoming: string): string {
  const before = normalise(existing)
  const after = normalise(incoming)

  if (after.text === '') return existing
  if (before.text === '') return incoming
  if (before.text.includes(after.text)) return existing

  const overlap = longestOverlap(before.text, after.text)
  const remainder = incoming.slice(after.sourceIndex[overlap])
  // A normalised text is trimmed, so an overlap always ends on a non-space — text following it
  // directly continues a word and must not be pushed apart by a space.
  const separator = overlap === 0 || /^\s/.test(remainder) ? ' ' : ''
  return existing.trimEnd() + separator + remainder.trimStart()
}

type Normalised = {
  text: string
  // `text.length + 1` entries — the last is the end of the source, so every cut is indexable.
  sourceIndex: number[]
}

// Counts down from the longest possible match so the **longest** overlap wins — a text box that
// repeats two lines must not join on the first single word that happens to line up.
function longestOverlap(before: string, after: string): number {
  // A shorter-than-minimum incoming text can only ever overlap by less than it.
  const minimum = after.length < MIN_OVERLAP ? 1 : MIN_OVERLAP
  for (let length = Math.min(before.length, after.length); length >= minimum; length--) {
    if (before.endsWith(after.slice(0, length))) return length
  }
  return 0
}

// Trimmed, with every run of whitespace collapsed to one space — a run's index is its first char.
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

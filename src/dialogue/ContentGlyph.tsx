import type { ReactElement } from 'react'
import type { DialogueContentKind } from '../project/types.ts'

// 16x16, filled not stroked — at ~14 device pixels a stroke reads as a grey smudge, so each
// glyph is one bold mass. Record, not a lookup function, so a fifth kind is a compile error here.
const CONTENT_KIND_PATH: Record<DialogueContentKind, string> = {
  text: 'M2 3.6h12v2.4H2z M2 6.8h12v2.4H2z M2 10h7.5v2.4H2z',
  image: 'M4.6 2.2a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z M1.4 13.6l4.8-6 3 3.7 2.2-2.5 3.2 4.8z',
  // Two offset frames; evenodd turns the overlap into a hole so they read as two shapes.
  gif: 'M6.8 1.8h7.4v7.4H6.8z M1.8 6.8h7.4v7.4H1.8z',
  video: 'M4.6 2.4 13.4 8l-8.8 5.6z',
}

export function ContentGlyph({ kind }: { kind: DialogueContentKind }): ReactElement {
  return (
    <svg
      className="content-glyph"
      viewBox="0 0 16 16"
      fill="currentColor"
      fillRule="evenodd"
      // Decorative: the pin's accessible name is the NPC's, and the legend carries the words.
      aria-hidden="true"
    >
      <path d={CONTENT_KIND_PATH[kind]} />
    </svg>
  )
}

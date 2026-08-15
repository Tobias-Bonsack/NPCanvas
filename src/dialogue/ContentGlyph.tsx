import type { ReactElement } from 'react'
import type { DialogueContent } from '../project/types.ts'

type ContentKind = DialogueContent['kind']

/**
 * Stroke-only paths in a 16×16 box. Hand-drawn SVG rather than emoji or an icon dependency:
 * emoji render differently per platform and at unpredictable weights, and a pin is a few
 * screen pixels of ink that has to stay legible at any zoom.
 *
 * A `Record`, not a lookup function, so a fifth content kind is a compile error here rather
 * than a pin that silently renders nothing.
 */
const CONTENT_KIND_PATH: Record<ContentKind, string> = {
  text: 'M3 4.5h10M3 8h10M3 11.5h6',
  image: 'M2.5 3.5h11v9h-11z M2.5 10l3.5-3.5 2.5 2.5 2-2 3 3',
  gif: 'M5.5 2.5h8v8 M2.5 5.5h8v8h-8z M4.5 11.5l2-2 1.5 1.5',
  video: 'M2.5 3.5h11v9h-11z M6.8 6l3.6 2-3.6 2z',
}

/** The mark on a pin and in the legend, so the two can never disagree about what a kind looks like. */
export function ContentGlyph({ kind }: { kind: ContentKind }): ReactElement {
  return (
    <svg
      className="content-glyph"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: the pin's accessible name is the NPC's, and the legend carries the words.
      aria-hidden="true"
    >
      <path d={CONTENT_KIND_PATH[kind]} />
    </svg>
  )
}

import type { ReactElement } from 'react'
import type { DialogueContent } from '../project/types.ts'

type ContentKind = DialogueContent['kind']

/**
 * Filled silhouettes in a 16×16 box. Hand-drawn SVG rather than emoji or an icon dependency:
 * emoji render differently per platform and at unpredictable weights, and a pin is a few
 * screen pixels of ink that has to stay legible.
 *
 * Filled, not stroked, because of that size. These render at roughly 14 device pixels, where
 * a 1.5-unit stroke lands near a single physical pixel and reads as a grey smudge — the shape
 * has to carry the meaning, so each glyph is one bold mass with no interior detail and no
 * enclosing frame to spend the space on.
 *
 * A `Record`, not a lookup function, so a fifth content kind is a compile error here rather
 * than a pin that silently renders nothing.
 */
const CONTENT_KIND_PATH: Record<ContentKind, string> = {
  /** Lines of text. */
  text: 'M2 3.6h12v2.4H2z M2 6.8h12v2.4H2z M2 10h7.5v2.4H2z',
  /** Sun over a mountain: a picture, with no frame to eat the little space there is. */
  image: 'M4.6 2.2a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z M1.4 13.6l4.8-6 3 3.7 2.2-2.5 3.2 4.8z',
  /**
   * Two offset frames. They overlap, and `evenodd` turns the overlap into a hole — which is
   * the only reason two same-coloured squares read as two shapes instead of one blob.
   */
  gif: 'M6.8 1.8h7.4v7.4H6.8z M1.8 6.8h7.4v7.4H1.8z',
  /** Play triangle. */
  video: 'M4.6 2.4 13.4 8l-8.8 5.6z',
}

/** The mark on a pin and in the legend, so the two can never disagree about what a kind looks like. */
export function ContentGlyph({ kind }: { kind: ContentKind }): ReactElement {
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

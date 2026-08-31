import type { ReactElement } from 'react'
import type { DialogueContentKind, RelevanceTag } from '../project/types.ts'
import { DIALOGUE_CONTENT_KINDS } from '../project/types.ts'
import { ContentGlyph } from './ContentGlyph.tsx'
import { relevanceColor } from './relevance.ts'
import './CanvasLegend.css'

/**
 * The words for each glyph. Here rather than beside the paths because this is the only place
 * a content kind is ever spelled out — and a `Record`, so a fifth kind is a compile error
 * rather than a legend that quietly stops explaining one of them.
 */
const CONTENT_KIND_LABEL: Record<DialogueContentKind, string> = {
  text: 'Text',
  image: 'Image',
  gif: 'Animated gif',
  video: 'Clip',
}

/**
 * What a pin's mark and colour mean. Rendered from the same `ContentGlyph` and the same hues
 * the pins use, so the legend cannot describe a scheme the canvas no longer draws.
 */
export function CanvasLegend({
  relevanceTags,
}: {
  relevanceTags: readonly RelevanceTag[]
}): ReactElement {
  return (
    <div className="canvas-legend hint-text">
      <ul className="canvas-legend__group" aria-label="Pin content kinds">
        {DIALOGUE_CONTENT_KINDS.map((kind) => (
          <li key={kind} className="canvas-legend__item">
            <span className="canvas-legend__glyph">
              <ContentGlyph kind={kind} />
            </span>
            {CONTENT_KIND_LABEL[kind]}
          </li>
        ))}
      </ul>

      {/* Collapsed by default: the content-kind glyphs above are four, fixed, and permanently
          worth the space; relevance is user-defined and can run to a dozen entries competing
          with the tool picker for the same band — see #95. `<ul>` inside `<details>` keeps its
          list semantics either way, open or closed. */}
      <details className="canvas-legend__details">
        <summary className="canvas-legend__summary disclosure-summary">Relevance colours</summary>
        <ul className="canvas-legend__group" aria-label="Pin relevance colours">
          {relevanceTags.map((tag) => (
            <li key={tag.id} className="canvas-legend__item">
              <span
                className="dot-swatch"
                style={{ background: relevanceColor(tag.hue) }}
              />
              {tag.name}
            </li>
          ))}
          {/* Named, because a neutral ring is a statement — "not classified yet" — and a reader
              who cannot find it in the legend will assume the colour simply failed to load. */}
          <li className="canvas-legend__item">
            <span className="dot-swatch canvas-legend__swatch--neutral" />
            Untagged
          </li>
        </ul>
      </details>
    </div>
  )
}

import type { ReactElement } from 'react'
import type { DialogueContent } from '../project/types.ts'
import { DIALOGUE_CONTENT_KINDS, RELEVANCE_TAGS } from '../project/types.ts'
import { ContentGlyph } from './ContentGlyph.tsx'
import { RELEVANCE_STYLE, relevanceColor } from './relevance.ts'
import './CanvasLegend.css'

/**
 * The words for each glyph. Here rather than beside the paths because this is the only place
 * a content kind is ever spelled out — and a `Record`, so a fifth kind is a compile error
 * rather than a legend that quietly stops explaining one of them.
 */
const CONTENT_KIND_LABEL: Record<DialogueContent['kind'], string> = {
  text: 'Text',
  image: 'Image',
  gif: 'Animated gif',
  video: 'Clip',
}

/**
 * What a pin's mark and colour mean. Rendered from the same `ContentGlyph` and the same hues
 * the pins use, so the legend cannot describe a scheme the canvas no longer draws.
 */
export function CanvasLegend(): ReactElement {
  return (
    <div className="canvas-legend">
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

      <ul className="canvas-legend__group" aria-label="Pin relevance colours">
        {RELEVANCE_TAGS.map((tag) => (
          <li key={tag} className="canvas-legend__item">
            <span className="canvas-legend__swatch" style={{ background: relevanceColor(tag) }} />
            {RELEVANCE_STYLE[tag].label}
          </li>
        ))}
        {/* Named, because a neutral ring is a statement — "not classified yet" — and a reader
            who cannot find it in the legend will assume the colour simply failed to load. */}
        <li className="canvas-legend__item">
          <span className="canvas-legend__swatch canvas-legend__swatch--neutral" />
          Untagged
        </li>
      </ul>
    </div>
  )
}

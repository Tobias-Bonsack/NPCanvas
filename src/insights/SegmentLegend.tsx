import type { ReactElement } from 'react'
import type { RelevanceTag } from '../project/types.ts'
import type { SegmentKey } from './relevance-segments.ts'
import { segmentColor, segmentKeys, segmentLabel } from './relevance-segments.ts'

type TextureShape = 'diagonal' | 'counter-diagonal' | 'dots' | 'grid' | 'verticals'

/**
 * The shapes a tagged segment cycles through, in the order the app's original four tags used
 * them — a palette indexed by *position* in `project.relevanceTags`, not by name, so today's
 * four tags keep drawing exactly as they did before a project could create, rename or reorder
 * its own tags. `untagged` keeps its own shape outside this palette, drawn from `shapeForSegment`
 * below.
 */
const TAG_SHAPES: readonly TextureShape[] = ['diagonal', 'counter-diagonal', 'dots', 'grid']

function shapeForSegment(segment: SegmentKey, index: number): TextureShape {
  if (segment === 'untagged') return 'verticals'
  return TAG_SHAPES[index % TAG_SHAPES.length]
}

/**
 * A texture per segment, so a chart survives being read by someone who cannot tell the hues
 * apart — and printed in greyscale. The shapes differ in *kind* (diagonal, counter-diagonal,
 * dots, grid, verticals), not merely in density.
 */
export function SegmentPattern({ id, shape }: { id: string; shape: TextureShape }): ReactElement {
  const ink = 'rgba(0, 0, 0, 0.34)'
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
      {shape === 'diagonal' && <path d="M0 6 6 0" stroke={ink} strokeWidth="1.6" />}
      {shape === 'counter-diagonal' && <path d="M0 0 6 6" stroke={ink} strokeWidth="1.6" />}
      {shape === 'dots' && <circle cx="3" cy="3" r="1.3" fill={ink} />}
      {shape === 'grid' && <path d="M0 3h6M3 0v6" stroke={ink} strokeWidth="1.1" />}
      {shape === 'verticals' && <path d="M1.5 0v6" stroke={ink} strokeWidth="1.2" />}
    </pattern>
  )
}

/**
 * Every pattern for one chart. The prefix exists because ids are document-global: two charts
 * on the same screen defining the same segment's pattern twice would both resolve to whichever
 * rendered first, and a third chart with a different palette would then silently inherit it.
 */
export function SegmentDefs({
  idPrefix,
  tags,
}: {
  idPrefix: string
  tags: readonly RelevanceTag[]
}): ReactElement {
  return (
    <defs>
      {segmentKeys(tags).map((segment, index) => (
        <SegmentPattern
          key={segment}
          id={`${idPrefix}-${segment}`}
          shape={shapeForSegment(segment, index)}
        />
      ))}
    </defs>
  )
}

/** What the colours mean, once per panel — the same swatch the bars are painted with. */
export function SegmentLegend({ tags }: { tags: readonly RelevanceTag[] }): ReactElement {
  const labels = segmentLabel(tags)
  const colors = segmentColor(tags)
  return (
    <ul className="insights__legend">
      {segmentKeys(tags).map((segment, index) => (
        <li key={segment} className="insights__legend-item">
          <svg className="insights__legend-swatch" viewBox="0 0 12 12" aria-hidden="true">
            <defs>
              <SegmentPattern id={`legend-${segment}`} shape={shapeForSegment(segment, index)} />
            </defs>
            <rect width="12" height="12" fill={colors.get(segment) ?? UNKNOWN_FILL} />
            <rect width="12" height="12" fill={`url(#legend-${segment})`} />
          </svg>
          {labels.get(segment) ?? ''}
        </li>
      ))}
    </ul>
  )
}

/** Unreachable in practice — every key in `segmentKeys(tags)` has an entry in `segmentColor(tags)`
 *  by construction — but a `Map` lookup is still typed as possibly missing. */
const UNKNOWN_FILL = 'transparent'

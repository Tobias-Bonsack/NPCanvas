import type { ReactElement } from 'react'
import type { RelevanceTag } from '../project/types.ts'
import type { SegmentKey } from './relevance-segments.ts'
import { segmentColor, segmentKeys, segmentLabel } from './relevance-segments.ts'

type TextureShape =
  | 'diagonal'
  | 'counter-diagonal'
  | 'dots'
  | 'grid'
  | 'crosshatch'
  | 'checkerboard'
  | 'verticals'

// Indexed by position in project.relevanceTags, not by name. untagged keeps its own shape
// ('verticals', via shapeForSegment) so it never collides. Past the sixth tag the palette repeats.
const TAG_SHAPES: readonly TextureShape[] = [
  'diagonal',
  'counter-diagonal',
  'dots',
  'grid',
  'crosshatch',
  'checkerboard',
]

function shapeForSegment(segment: SegmentKey, index: number): TextureShape {
  if (segment === 'untagged') return 'verticals'
  return TAG_SHAPES[index % TAG_SHAPES.length]
}

// A texture per segment so a chart survives being read greyscale, or by someone who can't tell
// hues apart — shapes differ in kind, not merely density.
function SegmentPattern({ id, shape }: { id: string; shape: TextureShape }): ReactElement {
  const ink = 'rgba(0, 0, 0, 0.34)'
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
      {shape === 'diagonal' && <path d="M0 6 6 0" stroke={ink} strokeWidth="1.6" />}
      {shape === 'counter-diagonal' && <path d="M0 0 6 6" stroke={ink} strokeWidth="1.6" />}
      {shape === 'dots' && <circle cx="3" cy="3" r="1.3" fill={ink} />}
      {shape === 'grid' && <path d="M0 3h6M3 0v6" stroke={ink} strokeWidth="1.1" />}
      {shape === 'crosshatch' && (
        <>
          <path d="M0 6 6 0" stroke={ink} strokeWidth="1" />
          <path d="M0 0 6 6" stroke={ink} strokeWidth="1" />
        </>
      )}
      {shape === 'checkerboard' && (
        <>
          <rect x="0" y="0" width="3" height="3" fill={ink} />
          <rect x="3" y="3" width="3" height="3" fill={ink} />
        </>
      )}
      {shape === 'verticals' && <path d="M1.5 0v6" stroke={ink} strokeWidth="1.2" />}
    </pattern>
  )
}

// idPrefix keeps two charts on the same screen from resolving to whichever pattern def
// rendered first — ids are document-global.
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

export function SegmentLegend({ tags }: { tags: readonly RelevanceTag[] }): ReactElement {
  const labels = segmentLabel(tags)
  const colors = segmentColor(tags)
  return (
    <ul className="insights__legend hint-text">
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

// Unreachable in practice, but a Map lookup is typed as possibly missing.
const UNKNOWN_FILL = 'transparent'

import type { ReactElement } from 'react'
import type { SegmentKey } from './relevance-segments.ts'
import { SEGMENT_COLOR, SEGMENT_KEYS, SEGMENT_LABEL } from './relevance-segments.ts'

/**
 * A texture per segment, so a chart survives being read by someone who cannot tell the hues
 * apart — and printed in greyscale. The shapes differ in *kind* (diagonal, counter-diagonal,
 * dots, grid, verticals), not merely in density.
 */
export function SegmentPattern({ id, segment }: { id: string; segment: SegmentKey }): ReactElement {
  const ink = 'rgba(0, 0, 0, 0.34)'
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
      {segment === 'out-of-world' && <path d="M0 6 6 0" stroke={ink} strokeWidth="1.6" />}
      {segment === 'worldbuilding' && <path d="M0 0 6 6" stroke={ink} strokeWidth="1.6" />}
      {segment === 'peoplebuilding' && <circle cx="3" cy="3" r="1.3" fill={ink} />}
      {segment === 'other' && <path d="M0 3h6M3 0v6" stroke={ink} strokeWidth="1.1" />}
      {segment === 'untagged' && <path d="M1.5 0v6" stroke={ink} strokeWidth="1.2" />}
    </pattern>
  )
}

/**
 * Every pattern for one chart. The prefix exists because ids are document-global: two charts
 * on the same screen defining `#worldbuilding` twice would both resolve to whichever rendered
 * first, and a third chart with a different palette would then silently inherit it.
 */
export function SegmentDefs({ idPrefix }: { idPrefix: string }): ReactElement {
  return (
    <defs>
      {SEGMENT_KEYS.map((segment) => (
        <SegmentPattern key={segment} id={`${idPrefix}-${segment}`} segment={segment} />
      ))}
    </defs>
  )
}

/** What the colours mean, once per panel — the same swatch the bars are painted with. */
export function SegmentLegend(): ReactElement {
  return (
    <ul className="insights__legend">
      {SEGMENT_KEYS.map((segment) => (
        <li key={segment} className="insights__legend-item">
          <svg className="insights__legend-swatch" viewBox="0 0 12 12" aria-hidden="true">
            <defs>
              <SegmentPattern id={`legend-${segment}`} segment={segment} />
            </defs>
            <rect width="12" height="12" fill={SEGMENT_COLOR[segment]} />
            <rect width="12" height="12" fill={`url(#legend-${segment})`} />
          </svg>
          {SEGMENT_LABEL[segment]}
        </li>
      ))}
    </ul>
  )
}

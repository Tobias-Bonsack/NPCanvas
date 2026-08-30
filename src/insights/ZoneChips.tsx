import type { ReactElement } from 'react'
import { zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { zoneHueStyle } from '../map/zone-style.ts'
import type { Zone } from '../project/types.ts'

/**
 * A dialogue's derived zones, or *Outside any zone* when it has none — location is derived, never
 * stored (CLAUDE.md), so how it is shown is decided here once rather than once per list that shows
 * a dialogue. The outer wrapper and its layout stay the caller's; only the chip run is shared.
 */
export function ZoneChips({
  zones,
  nowhereClassName,
}: {
  zones: readonly Zone[]
  nowhereClassName: string
}): ReactElement {
  if (zones.length === 0) {
    return <span className={nowhereClassName}>Outside any zone</span>
  }
  return (
    <>
      {zones.map((zone) => (
        <span key={zone.id} className="hue-chip dialogue-row__zone" style={zoneHueStyle(zone.hue)}>
          {zoneLabel(zone)}
        </span>
      ))}
    </>
  )
}

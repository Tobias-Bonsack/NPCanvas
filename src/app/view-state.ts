import { EMPTY_FILTER } from '../insights/filters.ts'
import type { DialogueFilter } from '../insights/filters.ts'
import type { BucketUnit } from '../insights/timeline-buckets.ts'
import type { Viewport } from '../map/viewport.ts'
import type { CanvasTool } from '../project/types.ts'
import type { QuestBoardMode } from '../quest/QuestBoard.tsx'

/**
 * Each view's transient state, lifted above `ReadyView`'s route switch so it survives a switch
 * away and back — see CLAUDE.md's note on `App` never migrating store scope. `App` owns exactly
 * one `useState` of this shape; nothing here is persisted to `data.json` or the hash.
 */
type ViewState = {
  canvas: CanvasViewState
  insights: InsightsViewState
  quests: QuestsViewState
}

export type CanvasViewState = {
  tool: CanvasTool
  questFilter: boolean
  /** Whether the chronological trail is drawn through the pins — see `TrailLayer`. */
  trail: boolean
  /** Whether a dialogue's stored references are drawn on the canvas — see `ReferenceLayer`. */
  references: boolean
  /** Whether the rail's Maps section is expanded — an uncontrolled `<details>` would spring
   * back open on every view switch. */
  mapsOpen: boolean
  /** `null` until the canvas has fitted itself once — see `MapCanvas`'s `initialViewport`. */
  viewport: Viewport | null
  /** `null` until the panel's resize handle is dragged once — the width the stylesheet gives it. */
  panelWidth: number | null
}

export type InsightsViewState = {
  filter: DialogueFilter
  /** The dossier's selected NPC key — `null` defers to its own top-of-list fallback. */
  dossierKey: string | null
  /** The open bucket's `start` instant (ms) — not an index, see `Timeline` — `null` shows no detail. */
  timelineActive: number | null
  /** The grain the timeline is read at; `null` is "Auto", deferring to `autoBucketUnit`. */
  timelineUnit: BucketUnit | null
}

export type QuestsViewState = {
  mode: QuestBoardMode
}

export const INITIAL_VIEW_STATE: ViewState = {
  canvas: {
    tool: { kind: 'inspect' },
    questFilter: false,
    trail: false,
    references: true,
    mapsOpen: true,
    viewport: null,
    panelWidth: null,
  },
  insights: { filter: EMPTY_FILTER, dossierKey: null, timelineActive: null, timelineUnit: null },
  quests: { mode: { kind: 'idle' } },
}

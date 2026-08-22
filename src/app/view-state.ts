import { EMPTY_FILTER } from '../insights/filters.ts'
import type { DialogueFilter } from '../insights/filters.ts'
import type { Viewport } from '../map/viewport.ts'
import type { CanvasTool } from '../project/types.ts'
import type { QuestBoardMode } from '../quest/QuestBoard.tsx'

/**
 * Each view's transient state, lifted above `ReadyView`'s route switch so it survives a switch
 * away and back — see CLAUDE.md's note on `App` never migrating store scope. `App` owns exactly
 * one `useState` of this shape; nothing here is persisted to `data.json` or the hash.
 */
export type ViewState = {
  canvas: CanvasViewState
  insights: InsightsViewState
  quests: QuestsViewState
}

export type CanvasViewState = {
  tool: CanvasTool
  questFilter: boolean
  /** `null` until the canvas has fitted itself once — see `MapCanvas`'s `initialViewport`. */
  viewport: Viewport | null
}

export type InsightsViewState = {
  filter: DialogueFilter
  /** The dossier's selected NPC key — `null` defers to its own top-of-list fallback. */
  dossierKey: string | null
  /** The open bucket's `start` instant (ms) — not an index, see `Timeline` — `null` shows no detail. */
  timelineActive: number | null
}

export type QuestsViewState = {
  mode: QuestBoardMode
}

export const INITIAL_VIEW_STATE: ViewState = {
  canvas: { tool: { kind: 'inspect' }, questFilter: false, viewport: null },
  insights: { filter: EMPTY_FILTER, dossierKey: null, timelineActive: null },
  quests: { mode: { kind: 'idle' } },
}

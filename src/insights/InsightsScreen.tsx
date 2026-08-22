import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { formatRoute } from '../app/route.ts'
import type { InsightsViewState } from '../app/view-state.ts'
import { indexDialoguesByZone } from '../map/zone-index.ts'
import type { ProjectFile, Zone, ZoneId } from '../project/types.ts'
import { FilterBar } from './FilterBar.tsx'
import { NpcDossier } from './NpcDossier.tsx'
import { RelevanceBreakdown } from './RelevanceBreakdown.tsx'
import { RelevanceTagList } from './RelevanceTagList.tsx'
import { Timeline } from './Timeline.tsx'
import { applyFilter, isEmptyFilter } from './filters.ts'
import './InsightsScreen.css'

/**
 * The third-priority view: the collection along every axis that is not position on the map.
 *
 * The filter, the open dossier and the open timeline bucket are lifted to `App` — not store
 * state, still transient view state like the canvas viewport and the active tool (see
 * CLAUDE.md § Store scope), just held one level higher so a view switch does not lose them.
 * `filter` lives here rather than inside `FilterBar` so every panel below reads the same
 * narrowed set, and so a chart segment can write back into it.
 */
export function InsightsScreen({
  project,
  viewState,
  onViewStateChange,
}: {
  project: ProjectFile
  viewState: InsightsViewState
  onViewStateChange: (viewState: InsightsViewState) => void
}): ReactElement {
  const { filter, dossierKey, timelineActive } = viewState
  const setFilter = (filter: InsightsViewState['filter']): void =>
    onViewStateChange({ ...viewState, filter })
  const setDossierKey = (dossierKey: InsightsViewState['dossierKey']): void =>
    onViewStateChange({ ...viewState, dossierKey })
  const setTimelineActive = (timelineActive: InsightsViewState['timelineActive']): void =>
    onViewStateChange({ ...viewState, timelineActive })

  // Locations are derived here exactly as the canvas and the board derive them — and through
  // the same cached index, so arriving on this screen rebuilds nothing.
  const zoneIndex = useMemo(
    () => indexDialoguesByZone(project.dialogues, project.zones),
    [project.dialogues, project.zones],
  )
  const dialogues = useMemo(
    () => applyFilter(project.dialogues, filter, zoneIndex),
    [project.dialogues, filter, zoneIndex],
  )
  // The timeline is the control for the date range, so it sees everything *except* that range:
  // a brush has to stay draggable after it has been drawn, and an axis rescaled to the selection
  // would leave nothing to drag back out of.
  const undated = useMemo(
    () => applyFilter(project.dialogues, { ...filter, from: null, to: null }, zoneIndex),
    [project.dialogues, filter, zoneIndex],
  )
  const zonesById = useMemo(() => byZoneId(project.zones), [project.zones])

  return (
    <section className="insights">
      <header className="insights__bar">
        <h1 className="insights__title">Insights</h1>
        <p className="insights__count">
          {dialogues.length} of {project.dialogues.length}{' '}
          {project.dialogues.length === 1 ? 'dialogue' : 'dialogues'}
          {isEmptyFilter(filter) ? '' : ' match the filter'}
        </p>
      </header>

      <RelevanceTagList
        relevanceTags={project.relevanceTags}
        dialogues={project.dialogues}
        filter={filter}
        onFilterChange={setFilter}
      />

      {project.dialogues.length === 0 ? (
        // The full FilterBar over zero dialogues is a large control surface with nothing to
        // control — see #45 — so it waits for the first dialogue along with everything else here.
        <p className="insights__empty">
          Nothing logged yet. Pin a dialogue on the{' '}
          <a href={formatRoute({ kind: 'canvas', dialogueId: null, focus: null })}>canvas</a> and
          it will show up here — by relevance, by where it was heard, and by who said it.
        </p>
      ) : (
        <>
          <FilterBar project={project} filter={filter} onChange={setFilter} />
          <Timeline
            dialogues={undated}
            zonesById={zonesById}
            zoneIndex={zoneIndex}
            relevanceTags={project.relevanceTags}
            filter={filter}
            onChange={setFilter}
            active={timelineActive}
            onActiveChange={setTimelineActive}
          />
          <RelevanceBreakdown
            dialogues={dialogues}
            zones={project.zones}
            zoneIndex={zoneIndex}
            relevanceTags={project.relevanceTags}
            filter={filter}
            onChange={setFilter}
          />
          <NpcDossier
            dialogues={dialogues}
            quests={project.quests}
            zonesById={zonesById}
            zoneIndex={zoneIndex}
            relevanceTags={project.relevanceTags}
            selectedKey={dossierKey}
            onSelectedKeyChange={setDossierKey}
          />
        </>
      )}
    </section>
  )
}

function byZoneId(zones: readonly Zone[]): ReadonlyMap<ZoneId, Zone> {
  const map = new Map<ZoneId, Zone>()
  for (const zone of zones) map.set(zone.id, zone)
  return map
}

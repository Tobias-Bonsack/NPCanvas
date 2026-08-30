import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { formatRoute } from '../app/route.ts'
import type { InsightsViewState } from '../app/view-state.ts'
import { indexDialoguesByZone } from '../map/zone-index.ts'
import type { ProjectFile, Zone, ZoneId } from '../project/types.ts'
import { FilterBar } from './FilterBar.tsx'
import { NpcDossier } from './NpcDossier.tsx'
import { RelevanceBreakdown } from './RelevanceBreakdown.tsx'
import { Timeline } from './Timeline.tsx'
import { applyFilter, isEmptyFilter } from './filters.ts'
import './InsightsScreen.css'

// filter, dossierKey and timelineActive are lifted to App as view state (see CLAUDE.md § Store
// scope) so a view switch doesn't lose them, and so a chart segment can write back into filter.
export function InsightsScreen({
  project,
  viewState,
  onViewStateChange,
}: {
  project: ProjectFile
  viewState: InsightsViewState
  onViewStateChange: (viewState: InsightsViewState) => void
}): ReactElement {
  const { filter, dossierKey, timelineActive, timelineUnit } = viewState
  const setFilter = (filter: InsightsViewState['filter']): void =>
    onViewStateChange({ ...viewState, filter })
  const setDossierKey = (dossierKey: InsightsViewState['dossierKey']): void =>
    onViewStateChange({ ...viewState, dossierKey })
  const setTimelineActive = (timelineActive: InsightsViewState['timelineActive']): void =>
    onViewStateChange({ ...viewState, timelineActive })
  // Changing the grain closes the open bucket in the same update — timelineActive is an instant
  // matched against a bucket's start, which an hour and a day disagree on.
  const setTimelineUnit = (timelineUnit: InsightsViewState['timelineUnit']): void =>
    onViewStateChange({ ...viewState, timelineUnit, timelineActive: null })

  const zoneIndex = useMemo(
    () => indexDialoguesByZone(project.dialogues, project.zones, project.maps),
    [project.dialogues, project.zones, project.maps],
  )
  const dialogues = useMemo(
    () => applyFilter(project.dialogues, filter, zoneIndex),
    [project.dialogues, filter, zoneIndex],
  )
  // The timeline sees everything except the date range, so a brush stays draggable after
  // it's drawn instead of rescaling the axis to the selection.
  const undated = useMemo(
    () => applyFilter(project.dialogues, { ...filter, from: null, to: null }, zoneIndex),
    [project.dialogues, filter, zoneIndex],
  )
  const zonesById = useMemo(() => byZoneId(project.zones), [project.zones])

  return (
    <section className="insights">
      <header className="insights__bar">
        <h1 className="screen-title">Insights</h1>
        <p className="insights__count hint-text">
          {dialogues.length} of {project.dialogues.length}{' '}
          {project.dialogues.length === 1 ? 'dialogue' : 'dialogues'}
          {isEmptyFilter(filter) ? '' : ' match the filter'}
        </p>
      </header>

      {project.dialogues.length === 0 ? (
        <p className="insights__empty hint-text">
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
            unit={timelineUnit}
            onUnitChange={setTimelineUnit}
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

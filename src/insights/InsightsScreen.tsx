import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { indexDialoguesByZone } from '../map/zone-index.ts'
import type { ProjectFile } from '../project/types.ts'
import { FilterBar } from './FilterBar.tsx'
import { RelevanceBreakdown } from './RelevanceBreakdown.tsx'
import type { DialogueFilter } from './filters.ts'
import { EMPTY_FILTER, applyFilter, isEmptyFilter } from './filters.ts'
import './InsightsScreen.css'

/**
 * The third-priority view: the collection along every axis that is not position on the map.
 *
 * The filter is component state, not store state — it is transient view state, like the canvas
 * viewport and the active tool (see CLAUDE.md § Store scope). It lives here rather than inside
 * `FilterBar` so every panel below reads the same narrowed set, and so a chart segment can
 * write back into it.
 */
export function InsightsScreen({ project }: { project: ProjectFile }): ReactElement {
  const [filter, setFilter] = useState<DialogueFilter>(EMPTY_FILTER)

  // Locations are derived here exactly as the canvas and the board derive them.
  const zoneIndex = useMemo(
    () => indexDialoguesByZone(project.dialogues, project.zones),
    [project.dialogues, project.zones],
  )
  const dialogues = useMemo(
    () => applyFilter(project.dialogues, filter, zoneIndex),
    [project.dialogues, filter, zoneIndex],
  )

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

      <FilterBar project={project} filter={filter} onChange={setFilter} />

      {project.dialogues.length === 0 ? (
        <p className="insights__empty">
          Nothing logged yet. Pin a dialogue on the canvas and it will show up here — by
          relevance, by where it was heard, and by who said it.
        </p>
      ) : (
        <RelevanceBreakdown
          dialogues={dialogues}
          zones={project.zones}
          zoneIndex={zoneIndex}
          filter={filter}
          onChange={setFilter}
        />
      )}
    </section>
  )
}

import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { formatRoute } from '../app/route.ts'
import { dialogueSnippet, formatSpokenAt, zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { relevanceHueStyle } from '../dialogue/relevance.ts'
import { MediaView } from '../media/MediaView.tsx'
import { byId } from '../project/derived.ts'
import type { ProjectFile, Quest } from '../project/types.ts'
import { indexQuestsByDialogue } from '../quest/quest-index.ts'
import { questAccentStyle } from '../quest/quest-style.ts'
import type { Moment, Reel } from './reel.ts'
import { arcStateAt } from './quest-arcs.ts'
import type { QuestArc } from './quest-arcs.ts'

/** What the stage says about a line — everything but the transport; see CLAUDE.md § "Cinema". */
export function CinemaStage({
  moment,
  frame,
  project,
  reel,
  arcs,
  announcement,
  onSeekMoment,
  onSeekFrame,
}: {
  moment: Moment
  frame: number
  project: ProjectFile
  reel: Reel
  arcs: readonly QuestArc[]
  announcement: string
  onSeekMoment: (index: number) => void
  onSeekFrame: (frame: number) => void
}): ReactElement {
  const { dialogue } = moment
  const zonesById = byId(project.zones)
  const mapsById = byId(project.maps)
  const relevanceTagsById = byId(project.relevanceTags)

  const zoneName = moment.zoneId === null ? null : (zonesById.get(moment.zoneId) ?? null)
  const mapName = mapsById.get(dialogue.mapId)?.name ?? null

  const questIndex = useMemo(() => indexQuestsByDialogue(project.quests), [project.quests])
  const quests = questIndex.get(dialogue.id) ?? []

  // `reel`, not `project.dialogues` — a reference to a line an unparseable `spokenAt` left out
  // of the reel has nowhere for the playhead to seek, so its control simply doesn't render.
  const momentIndexById = useMemo(
    () => new Map(reel.moments.map((candidate) => [candidate.dialogue.id, candidate.index])),
    [reel],
  )
  const references = dialogue.references.flatMap((id) => {
    const index = momentIndexById.get(id)
    return index === undefined ? [] : [{ index, dialogue: reel.moments[index].dialogue }]
  })

  const relevanceTags = dialogue.relevance.flatMap((id) => {
    const tag = relevanceTagsById.get(id)
    return tag === undefined ? [] : [tag]
  })

  const media = dialogue.media[frame] ?? dialogue.media[0]
  const frameCount = Math.max(1, dialogue.media.length)

  const openingArc = arcs.find((arc) => arc.firstMoment === moment.index)
  const closingArc = arcs.find(
    (arc) => arc.lastMoment === moment.index && arcStateAt(arc, moment.index) === 'done',
  )

  return (
    <div className="cinema-stage">
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {openingArc !== undefined && <ActCard kind="opens" quest={openingArc.quest} />}

      <div className="cinema-stage__frame">
        {media !== undefined && <MediaView media={media} label={dialogue.npcName} fit="fill" />}
      </div>

      {frameCount > 1 && (
        <div className="cinema-stage__frames">
          <div className="cinema-stage__dots" role="group" aria-label="Frames">
            {Array.from({ length: frameCount }, (_, index) => (
              <button
                key={index}
                type="button"
                className="cinema-stage__dot"
                aria-current={index === frame}
                aria-label={`Frame ${index + 1} of ${frameCount}`}
                onClick={() => onSeekFrame(index)}
              />
            ))}
          </div>
          <p className="cinema-stage__frame-count hint-text">
            {frame + 1} / {frameCount}
          </p>
        </div>
      )}

      <header className="cinema-stage__meta">
        <p className="cinema-stage__speaker">{dialogue.npcName}</p>
        <p className="cinema-stage__where hint-text">
          {[zoneName !== null ? zoneLabel(zoneName) : null, mapName, formatSpokenAt(dialogue.spokenAt)]
            .filter((part): part is string => part !== null)
            .join(' — ')}
        </p>
      </header>

      {dialogue.text !== '' && <p className="cinema-stage__text">{dialogue.text}</p>}

      {(relevanceTags.length > 0 || quests.length > 0) && (
        <ul className="cinema-stage__chips">
          {relevanceTags.map((tag) => (
            <li key={tag.id} className="hue-chip" style={relevanceHueStyle(tag.hue)}>
              {tag.name}
            </li>
          ))}
          {quests.map((quest) => (
            <li key={quest.id} className="hue-chip" style={questAccentStyle(quest)}>
              {questName(quest)}
            </li>
          ))}
        </ul>
      )}

      {references.length > 0 && (
        <ul className="cinema-stage__references">
          {references.map((target) => (
            <li key={target.dialogue.id}>
              <button type="button" className="button" onClick={() => onSeekMoment(target.index)}>
                {target.dialogue.npcName}: {dialogueSnippet(target.dialogue)}
              </button>
            </li>
          ))}
        </ul>
      )}

      <a className="button cinema-stage__canvas-link" href={formatRoute({ kind: 'canvas', dialogueId: dialogue.id, focus: null })}>
        Open on canvas
      </a>

      {closingArc !== undefined && <ActCard kind="seals" quest={closingArc.quest} />}
    </div>
  )
}

function ActCard({ kind, quest }: { kind: 'opens' | 'seals'; quest: Quest }): ReactElement {
  return (
    <div className="cinema-stage__act-card" style={questAccentStyle(quest)} role="status">
      <p className="micro-label">{kind === 'opens' ? 'Chapter opens' : 'Chapter seals'}</p>
      <p className="cinema-stage__act-name">{questName(quest)}</p>
    </div>
  )
}

function questName(quest: Quest): string {
  const trimmed = quest.name.trim()
  return trimmed === '' ? 'Untitled quest' : trimmed
}

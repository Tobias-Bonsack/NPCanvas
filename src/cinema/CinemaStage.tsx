import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dialogueSnippet } from '../dialogue-row/dialogue-summary.ts'
import { relevanceHueStyle } from '../dialogue/relevance.ts'
import { MediaView } from '../media/MediaView.tsx'
import { byId } from '../project/derived.ts'
import type { DialogueMedia, ProjectFile, Quest } from '../project/types.ts'
import { indexQuestsByDialogue } from '../quest/quest-index.ts'
import { questAccentStyle } from '../quest/quest-style.ts'
import type { Moment, Reel } from './reel.ts'

// A hard cut between two very different captures (the talk-animation's colour flash, most of
// all) reads as flicker. Crossfading over this long softens it without hiding the cut itself.
const FRAME_FADE_MS = 160

type FrameLayer = { media: DialogueMedia; renderKey: number }

/** Keeps the outgoing frame mounted just long enough to crossfade under the incoming one. */
function useFrameLayers(media: DialogueMedia | undefined): FrameLayer[] {
  const [layers, setLayers] = useState<FrameLayer[]>(() => (media === undefined ? [] : [{ media, renderKey: 0 }]))
  const nextKey = useRef(1)

  useEffect(() => {
    if (media === undefined) {
      setLayers([])
      return
    }
    setLayers((current) => {
      const top = current[current.length - 1]
      if (top !== undefined && top.media.id === media.id) return current
      return [...current, { media, renderKey: nextKey.current++ }]
    })
    const timer = setTimeout(() => {
      setLayers((current) => (current.length <= 1 ? current : current.slice(-1)))
    }, FRAME_FADE_MS)
    return () => clearTimeout(timer)
  }, [media])

  return layers
}

/** What the stage says about a line — everything but the transport; see CLAUDE.md § "Cinema". */
export function CinemaStage({
  moment,
  frame,
  project,
  reel,
  announcement,
  onSeekMoment,
  onSeekFrame,
}: {
  moment: Moment
  frame: number
  project: ProjectFile
  reel: Reel
  announcement: string
  onSeekMoment: (index: number) => void
  onSeekFrame: (frame: number) => void
}): ReactElement {
  const { dialogue } = moment
  const relevanceTagsById = byId(project.relevanceTags)
  const zonesById = byId(project.zones)
  const zone = moment.zoneId === null ? undefined : zonesById.get(moment.zoneId)

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
  const frameLayers = useFrameLayers(media)

  return (
    <div className="cinema-stage">
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      <p className="cinema-stage__speaker">
        {dialogue.npcName}
        {zone !== undefined && <span className="cinema-stage__zone hint-text"> — {zone.name}</span>}
      </p>

      <ul className="cinema-stage__chips cinema-stage__chips--relevance">
        {relevanceTags.length === 0 ? (
          <li className="hue-chip hue-chip--untagged">Untagged</li>
        ) : (
          relevanceTags.map((tag) => (
            <li key={tag.id} className="hue-chip" style={relevanceHueStyle(tag.hue)}>
              {tag.name}
            </li>
          ))
        )}
      </ul>

      <div className="cinema-stage__frame">
        {frameLayers.map((layer, index) => (
          <div
            key={layer.renderKey}
            className={
              index < frameLayers.length - 1
                ? 'cinema-stage__frame-layer cinema-stage__frame-layer--leaving'
                : 'cinema-stage__frame-layer'
            }
          >
            <MediaView media={layer.media} label={dialogue.npcName} fit="fill" />
          </div>
        ))}
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

      {dialogue.text !== '' && <p className="cinema-stage__text">{dialogue.text}</p>}

      {quests.length > 0 && (
        <ul className="cinema-stage__chips">
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
    </div>
  )
}

function questName(quest: Quest): string {
  const trimmed = quest.name.trim()
  return trimmed === '' ? 'Untitled quest' : trimmed
}

import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { selectDialogue } from '../app/select.ts'
import { resolveZones, zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { dispatch } from '../project/store.ts'
import type { Dialogue, DialogueId, Zone, ZoneId } from '../project/types.ts'
import './DialogueReferences.css'

// "Points at" is dialogue.references, edited here. "Pointed at by" is derived by scanning every
// other dialogue — the same shape DialogueQuestLinks uses to find a dialogue's quests — so the
// inverse can never disagree with the forward list stored on disk. The partner is picked by a
// click on its own pin rather than a search list — a name in a dropdown says nothing about
// where on the map it is, which is the whole reason to be looking at the canvas already.
export function DialogueReferences({
  dialogue,
  dialogues,
  zonesById,
  zoneIndex,
  picking,
  onStartPick,
  onCancelPick,
}: {
  dialogue: Dialogue
  dialogues: readonly Dialogue[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
  /** True while the canvas is armed and waiting for a click to name this dialogue's partner. */
  picking: boolean
  onStartPick: (dialogueId: DialogueId) => void
  onCancelPick: () => void
}): ReactElement {
  const dialogueId = dialogue.id
  const pointsAt = useMemo(
    () =>
      dialogue.references.flatMap((id) => {
        const target = dialogues.find((candidate) => candidate.id === id)
        return target === undefined ? [] : [target]
      }),
    [dialogue.references, dialogues],
  )
  const pointedAtBy = useMemo(
    () => dialogues.filter((candidate) => candidate.references.includes(dialogueId)),
    [dialogues, dialogueId],
  )

  return (
    <section className="dialogue-references">
      <h3 className="micro-label">Points at</h3>
      {pointsAt.length === 0 ? (
        <p className="dialogue-references__empty hint-text">Points at nothing yet.</p>
      ) : (
        <ul className="dialogue-references__list">
          {pointsAt.map((target) => (
            <li key={target.id} className="dialogue-references__item">
              <ReferenceRow target={target} zonesById={zonesById} zoneIndex={zoneIndex} />
              <button
                type="button"
                className="button"
                onClick={() =>
                  dispatch({
                    kind: 'dialogue/reference-removed',
                    dialogueId,
                    referenceId: target.id,
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking ? (
        <div className="dialogue-references__picking" role="status">
          <p className="dialogue-references__picking-hint hint-text">
            Click the pin it should point at…
          </p>
          <button type="button" className="button" onClick={onCancelPick}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="button" onClick={() => onStartPick(dialogueId)}>
          Point at another line…
        </button>
      )}

      <h3 className="micro-label">Pointed at by</h3>
      {pointedAtBy.length === 0 ? (
        <p className="dialogue-references__empty hint-text">Nothing points at this yet.</p>
      ) : (
        <ul className="dialogue-references__list">
          {pointedAtBy.map((source) => (
            <li key={source.id} className="dialogue-references__item">
              <ReferenceRow target={source} zonesById={zonesById} zoneIndex={zoneIndex} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ReferenceRow({
  target,
  zonesById,
  zoneIndex,
}: {
  target: Dialogue
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
}): ReactElement {
  const zones = resolveZones(target.id, zoneIndex, zonesById)
  const label = target.npcName.trim() === '' ? 'Unnamed NPC' : target.npcName.trim()
  return (
    <button
      type="button"
      className="dialogue-references__link"
      onClick={() => selectDialogue(target.id)}
    >
      {label}
      {zones.length > 0 && (
        <span className="dialogue-references__where"> — {zones.map(zoneLabel).join(', ')}</span>
      )}
    </button>
  )
}

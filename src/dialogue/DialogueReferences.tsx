import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { selectDialogue } from '../app/select.ts'
import { DialoguePicker } from '../dialogue-row/DialoguePicker.tsx'
import { resolveZones, zoneLabel } from '../dialogue-row/dialogue-summary.ts'
import { dispatch } from '../project/store.ts'
import type { Dialogue, DialogueId, Zone, ZoneId } from '../project/types.ts'
import './DialogueReferences.css'

type ReferenceMode = { kind: 'idle' } | { kind: 'picking' }

// "Points at" is dialogue.references, edited here. "Pointed at by" is derived by scanning every
// other dialogue — the same shape DialogueQuestLinks uses to find a dialogue's quests — so the
// inverse can never disagree with the forward list stored on disk.
export function DialogueReferences({
  dialogue,
  dialogues,
  zonesById,
  zoneIndex,
}: {
  dialogue: Dialogue
  dialogues: readonly Dialogue[]
  zonesById: ReadonlyMap<ZoneId, Zone>
  zoneIndex: ReadonlyMap<DialogueId, ZoneId[]>
}): ReactElement {
  const [mode, setMode] = useState<ReferenceMode>({ kind: 'idle' })

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

      {mode.kind === 'picking' ? (
        <DialoguePicker
          dialogues={dialogues}
          exclude={[dialogueId, ...dialogue.references]}
          zonesById={zonesById}
          zoneIndex={zoneIndex}
          emptyMessage="Every other dialogue in the project is already pointed at."
          onPick={(referenceId) => {
            dispatch({ kind: 'dialogue/reference-added', dialogueId, referenceId })
            setMode({ kind: 'idle' })
          }}
          onClose={() => setMode({ kind: 'idle' })}
        />
      ) : (
        <button type="button" className="button" onClick={() => setMode({ kind: 'picking' })}>
          Point at another line
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

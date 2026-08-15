import type { ReactElement } from 'react'
import { useId } from 'react'
import { dispatch } from '../project/store.ts'
import type { Dialogue } from '../project/types.ts'
import { fromLocalDateTimeValue, toLocalDateTimeValue } from './local-datetime.ts'
import { NpcNameInput } from './NpcNameInput.tsx'
import { RelevancePicker } from './RelevancePicker.tsx'
import './DialogueForm.css'

/**
 * Every field dispatches on change. There is deliberately no Save button: persistence is
 * autosave's job, and a second commit step would let the document and the folder disagree
 * about what the user believes they typed.
 */
export function DialogueForm({
  dialogue,
  npcNames,
}: {
  dialogue: Dialogue
  npcNames: readonly string[]
}): ReactElement {
  // One base id per form instance; each control suffixes it, so a second panel could never
  // collide and every label targets exactly its own control.
  const fieldId = useId()
  const dialogueId = dialogue.id

  return (
    <div className="dialogue-form">
      <div className="dialogue-form__field">
        <label className="dialogue-form__label" htmlFor={`${fieldId}-npc`}>
          NPC
        </label>
        <NpcNameInput
          id={`${fieldId}-npc`}
          value={dialogue.npcName}
          names={npcNames}
          onChange={(npcName) => dispatch({ kind: 'dialogue/npc-named', dialogueId, npcName })}
        />
      </div>

      <div className="dialogue-form__field">
        <label className="dialogue-form__label" htmlFor={`${fieldId}-spoken-at`}>
          Heard at
        </label>
        <input
          id={`${fieldId}-spoken-at`}
          className="dialogue-form__input"
          type="datetime-local"
          value={toLocalDateTimeValue(dialogue.spokenAt)}
          onChange={(event) => {
            // Chromium reports '' until every segment is filled. Skipping the dispatch keeps
            // the stored instant intact while the user retypes a component; the control
            // re-renders from the document, so nothing is lost either way.
            const spokenAt = fromLocalDateTimeValue(event.target.value)
            if (spokenAt !== null) dispatch({ kind: 'dialogue/spoken-at-set', dialogueId, spokenAt })
          }}
        />
      </div>

      <RelevancePicker
        value={dialogue.relevance}
        onChange={(relevance) => dispatch({ kind: 'dialogue/relevance-set', dialogueId, relevance })}
      />

      {/* Bound only for text content; the media variants are #12's business. */}
      {dialogue.content.kind === 'text' && (
        <div className="dialogue-form__field dialogue-form__field--grow">
          <label className="dialogue-form__label" htmlFor={`${fieldId}-text`}>
            What was said
          </label>
          <textarea
            id={`${fieldId}-text`}
            className="dialogue-form__textarea"
            value={dialogue.content.text}
            rows={8}
            placeholder="The line, as you heard it"
            onChange={(event) =>
              dispatch({ kind: 'dialogue/text-set', dialogueId, text: event.target.value })
            }
          />
        </div>
      )}
    </div>
  )
}

import type { ReactElement, RefObject } from 'react'
import { useId } from 'react'
import { dispatch } from '../project/store.ts'
import type { Dialogue } from '../project/types.ts'
import { useFieldDraft } from '../use-field-draft.ts'
import { fromLocalDateTimeValue, toLocalDateTimeValue } from './local-datetime.ts'
import { NpcNameInput } from './NpcNameInput.tsx'
import { RelevancePicker } from './RelevancePicker.tsx'
import './DialogueForm.css'

/**
 * There is deliberately no Save button: persistence is autosave's job, and a second commit step
 * would let the document and the folder disagree about what the user believes they typed.
 *
 * The two typed fields still go through `useFieldDraft` rather than dispatching per character.
 * A keystroke that reached the store would copy `project.dialogues`, and that array's identity is
 * what `PinLayer`'s `memo` guards — so writing a line would re-render every pin on the canvas,
 * per character. The discrete controls below (relevance, timestamp) dispatch immediately: they
 * are single acts, and a draft would only add a way to lose one.
 *
 * Must be rendered keyed on `dialogue.id` — see `useFieldDraft`.
 */
export function DialogueForm({
  dialogue,
  npcNames,
  flushRef,
}: {
  dialogue: Dialogue
  npcNames: readonly string[]
  /**
   * Filled with a function that pushes both drafts into the document now. The capture path holds
   * it because `captureIntoDialogue` appends to `dialogue.text` as the store has it, and the
   * Ctrl+Enter shortcut never blurs the field that is ahead of the store.
   */
  flushRef: RefObject<(() => void) | null>
}): ReactElement {
  // One base id per form instance; each control suffixes it, so a second panel could never
  // collide and every label targets exactly its own control.
  const fieldId = useId()
  const dialogueId = dialogue.id

  const npcDraft = useFieldDraft(dialogue.npcName, (npcName) =>
    dispatch({ kind: 'dialogue/npc-named', dialogueId, npcName }),
  )
  const textDraft = useFieldDraft(dialogue.text, (text) =>
    dispatch({ kind: 'dialogue/text-set', dialogueId, text }),
  )
  flushRef.current = () => {
    npcDraft.flush()
    textDraft.flush()
  }

  return (
    <div className="dialogue-form">
      <div className="dialogue-form__field">
        <label className="dialogue-form__label" htmlFor={`${fieldId}-npc`}>
          NPC
        </label>
        <NpcNameInput
          id={`${fieldId}-npc`}
          value={npcDraft.value}
          names={npcNames}
          onChange={npcDraft.onChange}
          onBlur={npcDraft.flush}
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

      {/* Always shown, including for a dialogue that carries pictures: the line and the frames
          proving it are separate fields, and a captured screenshot is transcribed into this one. */}
      <div className="dialogue-form__field dialogue-form__field--grow">
        <label className="dialogue-form__label" htmlFor={`${fieldId}-text`}>
          What was said
        </label>
        <textarea
          id={`${fieldId}-text`}
          className="dialogue-form__textarea"
          value={textDraft.value}
          rows={8}
          placeholder="The line, as you heard it"
          onChange={(event) => textDraft.onChange(event.target.value)}
          onBlur={textDraft.flush}
        />
      </div>
    </div>
  )
}

import type { ReactElement, RefObject } from 'react'
import { useEffect, useId, useRef } from 'react'
import { dispatch } from '../project/store.ts'
import type { Dialogue, RelevanceTag, RelevanceTagId } from '../project/types.ts'
import { useFieldDraft } from '../use-field-draft.ts'
import { relevanceNames } from './relevance.ts'
import { fromLocalDateTimeValue, toLocalDateTimeValue } from './local-datetime.ts'
import { NpcNameInput } from './NpcNameInput.tsx'
import { RelevancePicker } from './RelevancePicker.tsx'
import './DialogueForm.css'

// No Save button — persistence is autosave's job. The two typed fields go through useFieldDraft
// rather than dispatching per character: a keystroke reaching the store would copy
// project.dialogues, whose identity PinLayer's memo guards, re-rendering every pin per character.
// Must be rendered keyed on dialogue.id — see useFieldDraft.
export function DialogueForm({
  dialogue,
  relevanceTags,
  npcNames,
  flushRef,
  autoFocusNpc,
  onAutoFocusConsumed,
  previousRelevance,
}: {
  dialogue: Dialogue
  relevanceTags: readonly RelevanceTag[]
  npcNames: readonly string[]
  // Filled with a function that pushes both drafts now — the capture path uses it because
  // captureIntoDialogue appends to dialogue.text as the store has it.
  flushRef: RefObject<(() => void) | null>
  autoFocusNpc: boolean
  onAutoFocusConsumed: () => void
  previousRelevance: readonly RelevanceTagId[]
}): ReactElement {
  const fieldId = useId()
  const dialogueId = dialogue.id

  // Remounted per dialogue.id, so this guard is only about a second run of this mount's effect.
  const consumedAutoFocus = useRef(false)
  useEffect(() => {
    if (!autoFocusNpc || consumedAutoFocus.current) return
    consumedAutoFocus.current = true
    onAutoFocusConsumed()
  }, [autoFocusNpc, onAutoFocusConsumed])

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
        <label className="micro-label" htmlFor={`${fieldId}-npc`}>
          NPC
        </label>
        <NpcNameInput
          id={`${fieldId}-npc`}
          value={npcDraft.value}
          names={npcNames}
          onChange={npcDraft.onChange}
          onBlur={npcDraft.flush}
          autoFocus={autoFocusNpc}
        />
      </div>

      <div className="dialogue-form__field">
        <label className="micro-label" htmlFor={`${fieldId}-spoken-at`}>
          Heard at
        </label>
        <input
          id={`${fieldId}-spoken-at`}
          className="dialogue-form__input text-input"
          type="datetime-local"
          value={toLocalDateTimeValue(dialogue.spokenAt)}
          onChange={(event) => {
            // Chromium reports '' until every segment is filled — skip rather than clobber.
            const spokenAt = fromLocalDateTimeValue(event.target.value)
            if (spokenAt !== null) dispatch({ kind: 'dialogue/spoken-at-set', dialogueId, spokenAt })
          }}
        />
      </div>

      <RelevancePicker
        tags={relevanceTags}
        value={dialogue.relevance}
        onChange={(relevance) => dispatch({ kind: 'dialogue/relevance-set', dialogueId, relevance })}
      />

      {/* Only for a record nothing has touched yet, so this never overwrites a choice already made. */}
      {isUntouched(dialogue) && previousRelevance.length > 0 && (
        <button
          type="button"
          className="dialogue-form__carry-over"
          onClick={() =>
            dispatch({ kind: 'dialogue/relevance-set', dialogueId, relevance: [...previousRelevance] })
          }
        >
          Same as the last line: {relevanceNames(previousRelevance, relevanceTags).join(', ')}
        </button>
      )}

      <div className="dialogue-form__field dialogue-form__field--grow">
        <label className="micro-label" htmlFor={`${fieldId}-text`}>
          What was said
        </label>
        <textarea
          id={`${fieldId}-text`}
          className="dialogue-form__textarea text-input"
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

function isUntouched(dialogue: Dialogue): boolean {
  return dialogue.text.trim() === '' && dialogue.media.length === 0 && dialogue.relevance.length === 0
}

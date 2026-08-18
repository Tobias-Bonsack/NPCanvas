import type { ReactElement } from 'react'
import type { SaveState } from '../project/types.ts'
import { retrySave } from '../storage/autosave.ts'
import './SaveFailureBanner.css'

type FailedSave = Extract<SaveState, { kind: 'failed' }>

/**
 * The one state the app must not whisper: the document exists only in this tab. It used to be a
 * chip with the reason in a `title` attribute — unreachable by keyboard, unreachable by touch,
 * and invisible to anyone looking at the panel they were typing in. It gets the width of the
 * shell instead, with the reason as real text and the action beside it.
 *
 * `role="alert"` rather than `status`: this interrupts on purpose.
 */
export function SaveFailureBanner({
  save,
  onDismiss,
}: {
  save: FailedSave
  onDismiss: () => void
}): ReactElement {
  return (
    <div className="save-banner" role="alert">
      <div className="save-banner__text">
        <strong className="save-banner__title">Your changes are not saved</strong>
        <span className="save-banner__message">{save.message}</span>
      </div>
      {/* Straight off the click, no await before `retrySave`: a re-grant is a
          `requestPermission` call and it only prompts while the user gesture is still live. */}
      <button
        type="button"
        className="save-banner__action"
        onClick={() => void retrySave(save.failure)}
      >
        {save.failure === 'permission' ? 'Grant folder access' : 'Try saving again'}
      </button>
      <button
        type="button"
        className="save-banner__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss this warning"
      >
        ×
      </button>
    </div>
  )
}

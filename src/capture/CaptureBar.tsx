import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Disclosure } from '../app/Disclosure.tsx'
import { EditableRowDeleteConfirm, EditableRowRenameForm } from '../app/EditableRow.tsx'
import { useEditableRow } from '../app/use-editable-row.ts'
import { assertNever } from '../assert-never.ts'
import { dispatch } from '../project/store.ts'
import type { CaptureProfile, Glyph, RecorderAction, RecorderBinding } from '../project/types.ts'
import { RECORDER_ACTIONS } from '../project/types.ts'
import { setActiveCaptureProfileId, useActiveCaptureProfile } from './active-profile.ts'
import { CaptureCalibration } from './CaptureCalibration.tsx'
import type { ProfileCalibration } from './capture-profile.ts'
import { createCaptureProfile, profileApplies } from './capture-profile.ts'
import type { CaptureSource, FrozenFrame } from './capture-session.ts'
import {
  connectCaptureSource,
  disconnectCaptureSource,
  freezeFrame,
  releaseFrozenFrame,
  useCaptureSource,
} from './capture-session.ts'
import { readLiveBox } from './capture-to-dialogue.ts'
import { listenForNextEdge, useGamepadConnected } from './gamepad-watch.ts'
import { GlyphLearner } from './GlyphLearner.tsx'
import type { TextBoxReading } from './glyph-matcher.ts'
import { mergeGlyphs, readTextBox } from './glyph-matcher.ts'
import { GlyphSet } from './GlyphSet.tsx'
import './CaptureBar.css'

/** What each recorder action means, in the same words `CaptureRecorder`'s own buttons use. */
const ACTION_LABELS: Record<RecorderAction, string> = {
  'record-new': 'New capture',
  'record-extend': 'Extend last',
}

/**
 * The calibration overlay, as this bar sees it. `freezing` is its own state because grabbing a
 * frame is a round trip through the video element, and a second click during it would freeze a
 * second frame and leak the first.
 */
type CalibrationState =
  | { kind: 'closed' }
  | { kind: 'freezing' }
  | { kind: 'open'; frame: FrozenFrame; profile: CaptureProfile | null }
  | { kind: 'failed'; message: string }

/**
 * One read of the text box. The frame is kept beside the reading because learning a tile has to
 * transcribe *that* frame again — the emulator has moved on by then, and re-grabbing would read
 * a different box than the one whose characters were just typed in.
 */
type ReadState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'read'; frame: ImageData; reading: TextBoxReading }
  | { kind: 'failed'; message: string }

/**
 * The screen-capture connection and the profile that says where to read pixels out of it, as a
 * strip in the dialogue panel.
 *
 * Stateless about the connection itself — that lives in `capture-session.ts`, because it has to
 * outlive this component: the bar unmounts whenever the selection changes or the quest board is
 * opened, and the picker must run once per session, not once per mount. Which profile is active
 * lives in `active-profile.ts` for the same reason.
 */
export function CaptureBar({
  profiles,
  glyphs,
  bindings,
}: {
  profiles: readonly CaptureProfile[]
  glyphs: readonly Glyph[]
  bindings: readonly RecorderBinding[]
}): ReactElement {
  const source = useCaptureSource()
  const active = useActiveCaptureProfile(profiles)
  /**
   * A dismissed picker is not an error and not a state of the connection — nothing happened.
   * It is advice about one interaction, so it is local, like the panel's own import warnings.
   */
  const [cancelled, setCancelled] = useState(false)
  const [calibration, setCalibration] = useState<CalibrationState>({ kind: 'closed' })
  const editableProfile = useEditableRow()
  const [read, setRead] = useState<ReadState>({ kind: 'idle' })
  /** Whether the alphabet is open for review. Transient UI, like every other flag in this bar. */
  const [showingGlyphs, setShowingGlyphs] = useState(false)

  // A rename or delete confirmation belongs to the profile that was active when it opened;
  // switching the active profile out from under it must not leave a stray form or prompt open.
  // `close` is `useEditableRow`'s own stable `useCallback`, but the controller object wrapping
  // it is a fresh literal every render, so it goes through a ref rather than the dependency
  // list — the same pattern `PinLayer`'s `onPinSelectedRef` uses for the same reason.
  const closeEditableProfileRef = useRef(editableProfile.close)
  useEffect(() => {
    closeEditableProfileRef.current = editableProfile.close
  })
  const activeProfileId = active?.id ?? null
  useEffect(() => {
    closeEditableProfileRef.current()
  }, [activeProfileId])

  const gamepadConnected = useGamepadConnected()
  /** Which action's row is waiting for the next press, or `null` — at most one row at a time. */
  const [listeningAction, setListeningAction] = useState<RecorderAction | null>(null)
  /** `listenForNextEdge`'s own cancel function, so a second listen or an unmount can retract it. */
  const cancelListenRef = useRef<(() => void) | null>(null)

  function startListening(action: RecorderAction): void {
    cancelListenRef.current?.()
    setListeningAction(action)
    cancelListenRef.current = listenForNextEdge((buttonIndex) => {
      dispatch({ kind: 'recorder-binding/set', action, buttonIndex })
      cancelListenRef.current = null
      setListeningAction(null)
    })
  }

  function stopListening(): void {
    cancelListenRef.current?.()
    cancelListenRef.current = null
    setListeningAction(null)
  }

  // A controller unplugged mid-listen leaves nothing left to press — the row would otherwise read
  // "Listening…" forever once the section below stops rendering its rows at all.
  useEffect(() => {
    if (gamepadConnected) return
    cancelListenRef.current?.()
    cancelListenRef.current = null
    setListeningAction(null)
  }, [gamepadConnected])

  // And a listen abandoned by navigating away from Settings must not fire onto whatever row a
  // later visit starts listening on.
  useEffect(() => {
    return () => cancelListenRef.current?.()
  }, [])

  /** A box may only be read through a profile drawn against the frame that is live right now. */
  const readable =
    source.kind === 'live' &&
    active !== null &&
    profileApplies(active, source.frameWidth, source.frameHeight)

  // The frozen frame is an object URL this component owns; closing the overlay by any route —
  // including the selection changing out from under it — has to give it back.
  const frozen = calibration.kind === 'open' ? calibration.frame : null
  useEffect(() => {
    return () => {
      if (frozen !== null) releaseFrozenFrame(frozen)
    }
  }, [frozen])

  async function connect(): Promise<void> {
    setCancelled(false)
    const outcome = await connectCaptureSource()
    setCancelled(outcome === 'cancelled')
  }

  async function openCalibration(profile: CaptureProfile | null): Promise<void> {
    if (calibration.kind === 'freezing') return
    setCalibration({ kind: 'freezing' })
    try {
      setCalibration({ kind: 'open', frame: await freezeFrame(), profile })
    } catch (error) {
      setCalibration({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  function onCalibrationSaved(
    target: CaptureProfile | null,
    name: string,
    values: ProfileCalibration,
  ): void {
    if (target === null) {
      const profile = createCaptureProfile(name, values)
      dispatch({ kind: 'capture-profile/added', profile })
      // A profile is created to be used, so it becomes the active one immediately.
      setActiveCaptureProfileId(profile.id)
    } else {
      dispatch({ kind: 'capture-profile/renamed', profileId: target.id, name })
      dispatch({ kind: 'capture-profile/calibrated', profileId: target.id, calibration: values })
    }
    setCalibration({ kind: 'closed' })
  }

  async function readTheBox(profile: CaptureProfile): Promise<void> {
    if (read.kind === 'reading') return
    setRead({ kind: 'reading' })
    try {
      setRead({ kind: 'read', ...(await readLiveBox(profile, glyphs)) })
    } catch (error) {
      setRead({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  function onGlyphsLearned(profile: CaptureProfile, frame: ImageData, learned: Glyph[]): void {
    dispatch({ kind: 'glyphs/learned', glyphs: learned })
    // The store's own copy arrives on the next render, and the transcript is wanted now — so the
    // grown alphabet is applied here through the same merge the reducer just ran.
    setRead({ kind: 'read', frame, reading: readTextBox(frame, profile, mergeGlyphs(glyphs, learned)) })
  }

  function onRenameCommit(profile: CaptureProfile, name: string): void {
    const trimmed = name.trim()
    if (trimmed !== '') dispatch({ kind: 'capture-profile/renamed', profileId: profile.id, name: trimmed })
  }

  function onDeleteConfirmed(profile: CaptureProfile): void {
    dispatch({ kind: 'capture-profile/deleted', profileId: profile.id })
    // Falls back to whatever is left, which `useActiveCaptureProfile` resolves on the next render.
    setActiveCaptureProfileId(null)
  }

  function connectionRow(): ReactElement {
    switch (source.kind) {
      case 'idle':
      case 'failed':
        return (
          <button type="button" className="capture-bar__connect button--primary" onClick={() => void connect()}>
            {source.kind === 'failed' ? 'Try connecting again' : 'Connect a screen or window'}
          </button>
        )
      case 'requesting':
        return (
          <button type="button" className="capture-bar__connect button--primary" disabled>
            Choose a source in the picker…
          </button>
        )
      case 'live':
        return (
          <>
            <p className="capture-bar__source">
              <span className="capture-bar__label">{source.label}</span>
              <span className="capture-bar__size">
                {source.frameWidth} × {source.frameHeight}
              </span>
            </p>
            <button
              type="button"
              className="button"
              onClick={() => disconnectCaptureSource()}
            >
              Disconnect
            </button>
          </>
        )
      default:
        return assertNever(source)
    }
  }

  function profileRow(): ReactElement {
    if (editableProfile.mode === 'rename' && active !== null) {
      return (
        <EditableRowRenameForm
          value={active.name}
          label="Profile name"
          onCommit={(name) => onRenameCommit(active, name)}
          close={editableProfile.close}
          className="capture-bar__form"
          inputClassName="capture-bar__input text-input"
        />
      )
    }

    if (editableProfile.mode === 'delete' && active !== null) {
      return (
        <EditableRowDeleteConfirm
          message={
            <>
              Delete <strong>{active.name}</strong>? The alphabet is the project's and stays.
            </>
          }
          onConfirm={() => onDeleteConfirmed(active)}
          close={editableProfile.close}
          className="capture-bar__confirm"
        />
      )
    }

    return (
      <>
        {profiles.length > 0 && (
          <select
            className="capture-bar__select text-input"
            aria-label="Active capture profile"
            value={active === null ? '' : active.id}
            onChange={(event) =>
              setActiveCaptureProfileId(
                profiles.find((profile) => profile.id === event.target.value)?.id ?? null,
              )
            }
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="button"
          disabled={source.kind !== 'live' || calibration.kind === 'freezing'}
          title={source.kind === 'live' ? undefined : 'Connect a source first — calibration needs a frame.'}
          onClick={() => void openCalibration(null)}
        >
          {calibration.kind === 'freezing' ? 'Freezing a frame…' : 'New profile…'}
        </button>
        {active !== null && (
          <>
            <button
              type="button"
              className="button"
              disabled={source.kind !== 'live' || calibration.kind === 'freezing'}
              title={source.kind === 'live' ? undefined : 'Connect a source first — calibration needs a frame.'}
              onClick={() => void openCalibration(active)}
            >
              Re-calibrate
            </button>
            <button type="button" className="button" onClick={editableProfile.openRename}>
              Rename
            </button>
            <button type="button" className="button" onClick={editableProfile.openDelete}>
              Delete
            </button>
          </>
        )}
      </>
    )
  }

  return (
    <section className="capture-bar card" aria-label="Screen capture">
      <h3 className="micro-label">Capture source</h3>
      <div className="capture-bar__row">{connectionRow()}</div>
      <Disclosure>
        <p className="capture-bar__hint hint-text">
          A capture connection cannot be stored the way the project folder can, so it ends with
          the page — after a reload, connect once more.
        </p>
      </Disclosure>
      {cancelled && (
        <p className="capture-bar__note hint-text" role="status">
          Cancelled. Nothing is being captured.
        </p>
      )}
      {source.kind === 'failed' && (
        <p className="capture-bar__error hint-text" role="alert">
          {source.message}
        </p>
      )}

      <h3 className="micro-label">Capture profile</h3>
      <div className="capture-bar__row capture-bar__row--actions">{profileRow()}</div>
      {profiles.length === 0 && (
        <Disclosure>
          <p className="capture-bar__hint hint-text">
            A profile outlines the console screen inside the captured frame and the text box
            inside that. Drawn once, every capture afterwards is a single click.
          </p>
        </Disclosure>
      )}
      <MismatchWarning source={source} profile={active} />

      {active !== null && (
        <>
          <h3 className="micro-label">Text box</h3>
          <div className="capture-bar__row capture-bar__row--actions">
            <button
              type="button"
              className="button"
              disabled={!readable || read.kind === 'reading'}
              title={readable ? undefined : 'Connect the source this profile was calibrated against.'}
              onClick={() => void readTheBox(active)}
            >
              {read.kind === 'reading' ? 'Reading…' : 'Read the text box'}
            </button>
          </div>
          {/* Says what this is *not*, because there are now two buttons that read the same box:
              this one is the calibration check, and Capture the screen is the one that writes. */}
          <Disclosure>
            <p className="capture-bar__hint hint-text">
              A trial read. It shows what the box says and learns whatever tiles are new, but
              writes nothing to this dialogue — Capture the screen, above, is what attaches and
              appends.
            </p>
          </Disclosure>
          {read.kind === 'failed' && (
            <p className="capture-bar__error hint-text" role="alert">
              {read.message}
            </p>
          )}
          {read.kind === 'read' && read.reading.unknown.length === 0 && (
            <p className="capture-bar__transcript" role="status">
              {read.reading.text === '' ? 'The box read as empty.' : read.reading.text}
            </p>
          )}
        </>
      )}

      {/* Its own section, and not inside the `active !== null` block above: an alphabet belongs to
          the project, so correcting a mistyped character must not require a profile to be aimed at
          anything or a screen to be shared. */}
      <h3 className="micro-label">Alphabet</h3>
      <div className="capture-bar__row capture-bar__row--actions">
        <button type="button" className="button" onClick={() => setShowingGlyphs(true)}>
          Review the alphabet…
        </button>
        <span className="capture-bar__size">
          {glyphs.length} {glyphs.length === 1 ? 'glyph' : 'glyphs'} learned
        </span>
      </div>
      <Disclosure>
        <p className="capture-bar__hint hint-text">
          One alphabet for the whole project — every profile reads with it, so a second profile
          aimed at another box on the same console starts out already able to read.
        </p>
      </Disclosure>

      {/* Its own section too, for the same reason the alphabet is: a binding says how *this
          player* triggers a recording, not a measurement of the console — see CLAUDE.md. */}
      <h3 className="micro-label">Controller</h3>
      {gamepadConnected ? (
        RECORDER_ACTIONS.map((action) => (
          <RecorderBindingRow
            key={action}
            action={action}
            binding={bindings.find((candidate) => candidate.action === action)}
            listening={listeningAction === action}
            disabled={listeningAction !== null && listeningAction !== action}
            onListen={() => startListening(action)}
            onCancelListen={stopListening}
          />
        ))
      ) : (
        <p className="capture-bar__note hint-text" role="status">
          No controller is connected. Chrome only reports one once a button on it has been
          pressed, so press one now if it is already plugged in.
        </p>
      )}
      <Disclosure>
        <p className="capture-bar__hint hint-text">
          A controller button reaches the app only while this page has focus — it does not make
          the trigger global, only reachable without letting go of the controller. The New capture
          and Extend last buttons in the canvas sidebar's Captures region always work, bound or not.
        </p>
      </Disclosure>

      {calibration.kind === 'failed' && (
        <p className="capture-bar__error hint-text" role="alert">
          {calibration.message}
        </p>
      )}

      {showingGlyphs && <GlyphSet glyphs={glyphs} onClose={() => setShowingGlyphs(false)} />}

      {calibration.kind === 'open' && (
        <CaptureCalibration
          frame={calibration.frame}
          profile={calibration.profile}
          onCancel={() => setCalibration({ kind: 'closed' })}
          onSave={(name, values) => onCalibrationSaved(calibration.profile, name, values)}
        />
      )}

      {read.kind === 'read' && read.reading.unknown.length > 0 && active !== null && (
        <GlyphLearner
          tiles={read.reading.unknown}
          cancelLabel="Cancel"
          onCancel={() => setRead({ kind: 'idle' })}
          onConfirm={(glyphs) => onGlyphsLearned(active, read.frame, glyphs)}
        />
      )}
    </section>
  )
}

/**
 * One `RecorderAction`'s binding: what it is bound to, and the one control that changes that —
 * `Press a button…` while idle, `Listening…` plus a way to cancel once pressed. Button indices are
 * shown 1-based (`buttonIndex + 1`), matching how a person points at "button 3" on a pad rather
 * than the zero-based index `Gamepad.buttons` actually stores.
 */
function RecorderBindingRow({
  action,
  binding,
  listening,
  disabled,
  onListen,
  onCancelListen,
}: {
  action: RecorderAction
  binding: RecorderBinding | undefined
  listening: boolean
  /** Another row is listening — this one's `Press a button…` must not start a second one. */
  disabled: boolean
  onListen: () => void
  onCancelListen: () => void
}): ReactElement {
  return (
    <div className="capture-bar__row capture-bar__row--actions">
      <span className="capture-bar__binding-label">{ACTION_LABELS[action]}</span>
      <span className="capture-bar__size">
        {binding === undefined ? 'Not bound' : `Button ${binding.buttonIndex + 1}`}
      </span>
      {listening ? (
        <>
          <span className="capture-bar__note hint-text" role="status">
            Press the button to bind…
          </span>
          <button type="button" className="button" onClick={onCancelListen}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button type="button" className="button" disabled={disabled} onClick={onListen}>
            Press a button…
          </button>
          {binding !== undefined && (
            <button
              type="button"
              className="button"
              disabled={disabled}
              onClick={() => dispatch({ kind: 'recorder-binding/cleared', action })}
            >
              Clear
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Says so, loudly, when the live frame is not the one the profile was drawn against. Naming both
 * sizes is the whole point: re-fitting the rectangles would be a guess that fails quietly, and
 * reading glyphs out of pixels that moved is worse than reading none. See CLAUDE.md.
 */
function MismatchWarning({
  source,
  profile,
}: {
  source: CaptureSource
  profile: CaptureProfile | null
}): ReactElement | null {
  if (source.kind !== 'live' || profile === null) return null
  if (profileApplies(profile, source.frameWidth, source.frameHeight)) return null
  return (
    <p className="capture-bar__error hint-text" role="alert">
      {profile.name} was calibrated against a {profile.frameWidth} × {profile.frameHeight} frame,
      but this source is {source.frameWidth} × {source.frameHeight}. Re-calibrate it before
      capturing.
    </p>
  )
}

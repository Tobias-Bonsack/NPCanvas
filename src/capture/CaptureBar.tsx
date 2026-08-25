import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { assertNever } from '../assert-never.ts'
import { dispatch } from '../project/store.ts'
import type { CaptureProfile, Glyph } from '../project/types.ts'
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
import { GlyphLearner } from './GlyphLearner.tsx'
import type { TextBoxReading } from './glyph-matcher.ts'
import { mergeGlyphs, readTextBox } from './glyph-matcher.ts'
import { GlyphSet } from './GlyphSet.tsx'
import './CaptureBar.css'

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

/** The profile row's transient modes, one at a time — the same shape `MapList` uses. */
type ProfileMode = { kind: 'idle' } | { kind: 'renaming'; draft: string } | { kind: 'confirming-delete' }

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
}: {
  profiles: readonly CaptureProfile[]
  glyphs: readonly Glyph[]
}): ReactElement {
  const source = useCaptureSource()
  const active = useActiveCaptureProfile(profiles)
  /**
   * A dismissed picker is not an error and not a state of the connection — nothing happened.
   * It is advice about one interaction, so it is local, like the panel's own import warnings.
   */
  const [cancelled, setCancelled] = useState(false)
  const [calibration, setCalibration] = useState<CalibrationState>({ kind: 'closed' })
  const [mode, setMode] = useState<ProfileMode>({ kind: 'idle' })
  const [read, setRead] = useState<ReadState>({ kind: 'idle' })
  /** Whether the alphabet is open for review. Transient UI, like every other flag in this bar. */
  const [showingGlyphs, setShowingGlyphs] = useState(false)

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

  function onRenameSubmit(profile: CaptureProfile, draft: string): void {
    const name = draft.trim()
    if (name !== '') dispatch({ kind: 'capture-profile/renamed', profileId: profile.id, name })
    setMode({ kind: 'idle' })
  }

  function onDeleteConfirmed(profile: CaptureProfile): void {
    dispatch({ kind: 'capture-profile/deleted', profileId: profile.id })
    // Falls back to whatever is left, which `useActiveCaptureProfile` resolves on the next render.
    setActiveCaptureProfileId(null)
    setMode({ kind: 'idle' })
  }

  function connectionRow(): ReactElement {
    switch (source.kind) {
      case 'idle':
      case 'failed':
        return (
          <button type="button" className="capture-bar__connect" onClick={() => void connect()}>
            {source.kind === 'failed' ? 'Try connecting again' : 'Connect a screen or window'}
          </button>
        )
      case 'requesting':
        return (
          <button type="button" className="capture-bar__connect" disabled>
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
    if (mode.kind === 'renaming' && active !== null) {
      return (
        <form
          className="capture-bar__form"
          onSubmit={(event) => {
            event.preventDefault()
            onRenameSubmit(active, mode.draft)
          }}
        >
          <input
            className="capture-bar__input"
            value={mode.draft}
            autoFocus
            aria-label="Profile name"
            onChange={(event) => setMode({ kind: 'renaming', draft: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMode({ kind: 'idle' })
            }}
          />
          <button type="submit" className="button">
            Save
          </button>
          <button type="button" className="button" onClick={() => setMode({ kind: 'idle' })}>
            Cancel
          </button>
        </form>
      )
    }

    if (mode.kind === 'confirming-delete' && active !== null) {
      return (
        <div className="capture-bar__confirm" role="alert">
          <span>
            Delete <strong>{active.name}</strong>? The alphabet is the project's and stays.
          </span>
          <button
            type="button"
            className="button button--danger"
            onClick={() => onDeleteConfirmed(active)}
          >
            Delete
          </button>
          <button type="button" className="button" onClick={() => setMode({ kind: 'idle' })}>
            Cancel
          </button>
        </div>
      )
    }

    return (
      <>
        {profiles.length > 0 && (
          <select
            className="capture-bar__select"
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
            <button
              type="button"
              className="button"
              onClick={() => setMode({ kind: 'renaming', draft: active.name })}
            >
              Rename
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setMode({ kind: 'confirming-delete' })}
            >
              Delete
            </button>
          </>
        )}
      </>
    )
  }

  return (
    <section className="capture-bar" aria-label="Screen capture">
      <h3 className="micro-label">Capture source</h3>
      <div className="capture-bar__row">{connectionRow()}</div>
      <p className="capture-bar__hint">
        A capture connection cannot be stored the way the project folder can, so it ends with the
        page — after a reload, connect once more.
      </p>
      {cancelled && (
        <p className="capture-bar__note" role="status">
          Cancelled. Nothing is being captured.
        </p>
      )}
      {source.kind === 'failed' && (
        <p className="capture-bar__error" role="alert">
          {source.message}
        </p>
      )}

      <h3 className="micro-label">Capture profile</h3>
      <div className="capture-bar__row capture-bar__row--actions">{profileRow()}</div>
      {profiles.length === 0 && (
        <p className="capture-bar__hint">
          A profile outlines the console screen inside the captured frame and the text box inside
          that. Drawn once, every capture afterwards is a single click.
        </p>
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
          <p className="capture-bar__hint">
            A trial read. It shows what the box says and learns whatever tiles are new, but writes
            nothing to this dialogue — Capture the screen, above, is what attaches and appends.
          </p>
          {read.kind === 'failed' && (
            <p className="capture-bar__error" role="alert">
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
      <p className="capture-bar__hint">
        One alphabet for the whole project — every profile reads with it, so a second profile aimed
        at another box on the same console starts out already able to read.
      </p>

      {calibration.kind === 'failed' && (
        <p className="capture-bar__error" role="alert">
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
    <p className="capture-bar__error" role="alert">
      {profile.name} was calibrated against a {profile.frameWidth} × {profile.frameHeight} frame,
      but this source is {source.frameWidth} × {source.frameHeight}. Re-calibrate it before
      capturing.
    </p>
  )
}

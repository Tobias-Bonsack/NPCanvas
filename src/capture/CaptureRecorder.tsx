import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { setActiveCaptureProfileId, useActiveCaptureProfile } from './active-profile.ts'
import { useCaptureSource } from './capture-session.ts'
import { captureBlocker } from './capture-to-dialogue.ts'
import type { WatchState } from './capture-watch.ts'
import {
  describeReplay,
  discardHeldFrames,
  heldUnknownTiles,
  replayHeldFrames,
  triggerRecording,
  useWatchState,
  useWatching,
} from './capture-watch.ts'
import { GlyphLearner } from './GlyphLearner.tsx'
import type { UnknownTile } from './glyph-matcher.ts'
import { mergeGlyphs } from './glyph-matcher.ts'
import { HeldNote } from './HeldNote.tsx'
import type { CaptureProfile, Glyph, PendingCapture } from '../project/types.ts'
import { dispatch, useAppStateExceptSave } from '../project/store.ts'
import { describeError } from '../storage/project-directory.ts'
import './CaptureRecorder.css'

type HeldCaptureState =
  | { kind: 'idle' }
  | { kind: 'capturing' }
  | {
      kind: 'learning-held'
      profile: CaptureProfile
      glyphs: readonly Glyph[]
      tiles: readonly UnknownTile[]
    }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string }

// Two buttons, not a toggle: `New capture` always opens a fresh conversation, `Extend last`
// reopens `pendingCaptures.at(-1)`. `HeldNote` is rendered here rather than from the dialogue
// panel — a held frame belongs to the capture the watcher was recording when it read it, never to
// whichever line happens to be selected.
export function CaptureRecorder(): ReactElement {
  const appState = useAppStateExceptSave()
  const captureProfiles = appState.kind === 'ready' ? appState.project.captureProfiles : []
  const pendingCaptures = appState.kind === 'ready' ? appState.project.pendingCaptures : []
  const glyphs = appState.kind === 'ready' ? appState.project.glyphs : []
  const source = useCaptureSource()
  const profile = useActiveCaptureProfile(captureProfiles)
  const blocker = captureBlocker(source, profile)
  const watching = useWatching()
  const watch = useWatchState()

  const [heldState, setHeldState] = useState<HeldCaptureState>({ kind: 'idle' })
  const heldBusy = heldState.kind === 'capturing' || heldState.kind === 'learning-held'

  function trigger(mode: 'new' | 'extend'): void {
    triggerRecording(mode)
  }

  // A queue with nothing left to ask — the alphabet grew for another reason since — replays
  // straight away rather than opening a learner with no tiles in it.
  function answerHeld(): void {
    if (heldBusy || profile === null) return
    const tiles = heldUnknownTiles(profile, glyphs)
    if (tiles.length === 0) {
      void replayHeld(profile, glyphs)
      return
    }
    setHeldState({ kind: 'learning-held', profile, glyphs, tiles })
  }

  function discardHeld(): void {
    const waiting = discardHeldFrames()
    setHeldState({
      kind: 'done',
      message:
        waiting === 1
          ? '1 waiting box was discarded. Nothing was written.'
          : `${waiting} waiting boxes were discarded. Nothing was written.`,
    })
  }

  async function replayHeld(target: CaptureProfile, alphabet: readonly Glyph[]): Promise<void> {
    setHeldState({ kind: 'capturing' })
    try {
      setHeldState({
        kind: 'done',
        message: describeReplay(await replayHeldFrames(target, alphabet)),
      })
    } catch (error) {
      setHeldState({ kind: 'failed', message: describeError(error) })
    }
  }

  function onHeldGlyphsLearned(
    target: CaptureProfile,
    alphabet: readonly Glyph[],
    learned: Glyph[],
  ): void {
    dispatch({ kind: 'glyphs/learned', glyphs: learned })
    // The frames are re-read now, before the store's own copy arrives on the next render, so the
    // grown alphabet is applied here through the same merge the reducer just ran.
    void replayHeld(target, mergeGlyphs(alphabet, learned))
  }

  const last: PendingCapture | undefined = pendingCaptures.at(-1)
  const extendTitle =
    last === undefined
      ? 'Nothing to extend yet — starts a new capture, same as New capture'
      : `Add to "${last.npcName}", the last capture recorded`

  return (
    <div className="capture-recorder">
      <h2 className="micro-label">Captures</h2>
      <div className="capture-recorder__watch">
        <WatcherStatus watch={watch} pendingCaptures={pendingCaptures} />
        {captureProfiles.length > 0 && (
          <ProfileSwitcher profiles={captureProfiles} active={profile} />
        )}
        <div className="capture-recorder__triggers">
          <button
            type="button"
            className="capture-recorder__watch-toggle button"
            data-watching={watching ? 'true' : undefined}
            aria-pressed={watching}
            disabled={blocker !== null && !watching}
            title={
              watching
                ? 'Stop reading the text box'
                : (blocker ??
                  'Start a new conversation — every box that comes to rest is recorded into it')
            }
            onClick={() => trigger('new')}
          >
            {watching ? 'Stop' : 'New capture'}
          </button>
          <button
            type="button"
            className="capture-recorder__watch-toggle button"
            data-watching={watching ? 'true' : undefined}
            aria-pressed={watching}
            disabled={blocker !== null && !watching}
            title={watching ? 'Stop reading the text box' : (blocker ?? extendTitle)}
            onClick={() => trigger('extend')}
          >
            {watching ? 'Stop' : 'Extend last'}
          </button>
        </div>
      </div>
      <HeldNote
        onAnswer={answerHeld}
        onDiscard={discardHeld}
        answerDisabled={heldBusy || profile === null}
        discardDisabled={heldBusy}
      />
      {heldState.kind === 'done' && (
        <p className="capture-recorder__watch-note" role="status">
          {heldState.message}
        </p>
      )}
      {heldState.kind === 'failed' && (
        <p className="error-text" role="alert">
          {heldState.message}
        </p>
      )}
      {heldState.kind === 'learning-held' && (
        <GlyphLearner
          tiles={heldState.tiles}
          cancelLabel="Cancel"
          onCancel={() => setHeldState({ kind: 'idle' })}
          onConfirm={(learned) => onHeldGlyphsLearned(heldState.profile, heldState.glyphs, learned)}
        />
      )}
    </div>
  )
}

// Changing which profile the triggers below record against without a trip to Settings — the
// full rename/re-calibrate/delete controls stay on CaptureBar, this is only the switch.
function ProfileSwitcher({
  profiles,
  active,
}: {
  profiles: readonly CaptureProfile[]
  active: CaptureProfile | null
}): ReactElement {
  return (
    <label className="capture-recorder__profile">
      <span className="capture-recorder__profile-label">Profile</span>
      <select
        className="capture-recorder__profile-select text-input"
        aria-label="Active capture profile"
        value={active === null ? '' : active.id}
        onChange={(event) =>
          setActiveCaptureProfileId(
            profiles.find((candidate) => candidate.id === event.target.value)?.id ?? null,
          )
        }
      >
        {profiles.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>
    </label>
  )
}

// Its own component with its own subscription, so a box appended re-renders this line and not
// the rest of `CaptureRecorder` — and its own one-second tick, since "read 40s ago" keeps
// counting while the watcher publishes nothing at all.
function WatcherStatus({
  watch,
  pendingCaptures,
}: {
  watch: WatchState
  pendingCaptures: readonly PendingCapture[]
}): ReactElement | null {
  const ticking = watch.kind === 'watching'
  const [, retick] = useState(0)

  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => retick((count) => count + 1), 1000)
    return () => clearInterval(timer)
  }, [ticking])

  if (watch.kind === 'off') {
    return watch.message === null ? null : (
      <p className="capture-recorder__watch-note" role="alert">
        Watching stopped. {watch.message}
      </p>
    )
  }

  return (
    <div className="capture-recorder__watch-status">
      <p className="capture-recorder__watch-note" title={watch.lastText ?? undefined}>
        {watchSummary(watch, watchTarget(watch, pendingCaptures))}
      </p>
      {watch.paused !== null && (
        <p className="capture-recorder__watch-paused hint-text" role="status">
          {watch.paused}
        </p>
      )}
    </div>
  )
}

function watchTarget(
  watch: Extract<WatchState, { kind: 'watching' }>,
  pendingCaptures: readonly PendingCapture[],
): string {
  if (watch.captureId === null) return 'Recording a new conversation'
  const capture = pendingCaptures.find((candidate) => candidate.id === watch.captureId)
  const name = capture?.npcName.trim() ?? ''
  return name === '' ? 'Recording into an unnamed capture' : `Recording into ${name}`
}

function watchSummary(watch: Extract<WatchState, { kind: 'watching' }>, target: string): string {
  const parts = [
    watch.appended === 1 ? '1 box appended' : `${watch.appended} boxes appended`,
    watch.conversations === 0
      ? null
      : watch.conversations === 1
        ? '1 conversation recorded'
        : `${watch.conversations} conversations recorded`,
    watch.repeated === 0 ? null : `${watch.repeated} said nothing new`,
    watch.dropped === 0
      ? null
      : `${watch.dropped} in-between ${watch.dropped === 1 ? 'picture' : 'pictures'} dropped`,
    sinceRead(watch.lastReadAt),
  ]
  return `${target} · ${parts.filter((part) => part !== null).join(' · ')}`
}

function sinceRead(lastReadAt: number | null): string {
  if (lastReadAt === null) return 'nothing read yet'
  const seconds = Math.max(0, Math.round((Date.now() - lastReadAt) / 1000))
  if (seconds < 2) return 'reading'
  if (seconds < 60) return `read ${seconds} s ago`
  return `read ${Math.floor(seconds / 60)} min ago`
}

import { assertNever } from '../assert-never.ts'
import type { AppState, ProjectFile } from '../project/types.ts'

// Long enough that a burst of typing is one write, short enough that a user who alt-tabs away
// without triggering `visibilitychange` still loses under a second of work.
export const DEBOUNCE_MS = 800

/**
 * The most a debounce may ever delay a write past the **first** unwritten edit.
 *
 * `DEBOUNCE_MS` alone assumes edits arrive in a burst that ends — the case it was tuned for. A
 * watcher recording is not a burst: it settles a box roughly every 600 ms for as long as the
 * conversation runs, and each box re-arms the 800 ms timer before it can fire, so the one
 * situation the app is *designed* to leave running unattended is the one situation in which
 * nothing reaches disk. Six or seven boxes of a scrolling conversation, still far less than a
 * lost minute — and far less than the whole conversation a crash or a discarded tab would cost
 * without a ceiling.
 */
export const MAX_UNSAVED_MS = 5000

/**
 * How long a debounce armed now may still wait, given when the oldest unwritten edit landed.
 *
 * Never past `MAX_UNSAVED_MS` from that edit: past the deadline this is `0`, which the caller
 * reads as "write immediately" rather than arming a zero-length timer specially.
 */
export function nextDebounceMs(oldestUnwrittenEditAt: number, now: number): number {
  const deadline = oldestUnwrittenEditAt + MAX_UNSAVED_MS
  return Math.max(0, Math.min(DEBOUNCE_MS, deadline - now))
}

/**
 * Autosave's decisions, split out of the module that owns the timers and the IO so they can be
 * tested at all — see CLAUDE.md § Testing scope. Only the decision moves; nothing here reads a
 * clock, touches a timer, or writes a file.
 *
 * Two functions rather than one because the debounce sits between them: a store change decides
 * whether a write is *coming*, and the write, when it comes due, decides against a store that
 * has had 800 ms to move on. Folding them together would make every keystroke during an
 * in-flight write queue a follow-up immediately instead of debouncing first.
 */

/** What a store change means. Carries the document, so the caller cannot adopt the wrong one. */
export type ChangeDecision =
  /** Not connected. Drop the pending write — it must not land in a folder the user has left. */
  | { kind: 'drop' }
  /**
   * Freshly loaded. Adopt it as the baseline and write nothing: it is already on disk, and
   * writing it back would be a spurious save on every connect.
   */
  | { kind: 'adopt'; project: ProjectFile }
  /** Same document, different app state — a selection or the save state itself. */
  | { kind: 'ignore' }
  /** A real edit. Debounce a write. */
  | { kind: 'schedule'; project: ProjectFile }

/** What a write attempt should do. `write` carries exactly the document to put on disk. */
export type WriteDecision =
  /**
   * A write is already running. At most one follow-up ever queues: it re-reads the current
   * document when it runs, so any number of edits during this write collapse into that pass.
   */
  | { kind: 'queue' }
  /** Nothing to write — the project was disconnected between the schedule and now. */
  | { kind: 'skip' }
  | { kind: 'write'; project: ProjectFile }

/**
 * `previous` is the document the last decision adopted, or `null` when none is adopted —
 * which is both the state before the first load and the state after a disconnect.
 */
export function decideOnStoreChange(
  state: AppState,
  previous: ProjectFile | null,
): ChangeDecision {
  if (state.kind !== 'ready') return { kind: 'drop' }
  if (previous === null) return { kind: 'adopt', project: state.project }
  // Reference identity, not a deep compare: the reducer returns the same object for every
  // action that did not touch the document, which is what makes this cheap and exact.
  if (previous === state.project) return { kind: 'ignore' }
  return { kind: 'schedule', project: state.project }
}

export function decideOnWrite(state: AppState, writeInFlight: boolean): WriteDecision {
  if (writeInFlight) return { kind: 'queue' }
  if (state.kind !== 'ready') return { kind: 'skip' }
  return { kind: 'write', project: state.project }
}

/**
 * Whether the store holds edits that are not on disk — what the unload warning asks. `failed`
 * counts, and counts most: it is the one state where the edits are *guaranteed* absent from the
 * folder, and the one the warning used to skip entirely.
 */
export function hasUnsavedEdits(state: AppState): boolean {
  if (state.kind !== 'ready') return false
  switch (state.save.kind) {
    case 'saved':
      return false

    case 'pending':
    case 'saving':
    case 'failed':
      return true

    default:
      return assertNever(state.save)
  }
}

/**
 * Whether hiding the tab should start a write now — a narrower question than `hasUnsavedEdits`,
 * and the reason the two are not one function.
 *
 * `saving` is excluded: the document in the store is already the one being written, because an
 * edit landing mid-write moves the state to `pending`. Flushing there only sets `writeQueued`,
 * which suppresses the in-flight write's `save/saved` and then rewrites byte-identical JSON.
 *
 * `failed` is included, and is the whole point: there is no debounce timer left after a failed
 * write, so the old timer-based guard skipped exactly the state whose edits were known to be
 * only in memory — on the last event a discarded tab ever fires.
 */
export function needsFlushOnHide(state: AppState): boolean {
  if (state.kind !== 'ready') return false
  switch (state.save.kind) {
    case 'saved':
    case 'saving':
      return false

    case 'pending':
    case 'failed':
      return true

    default:
      return assertNever(state.save)
  }
}

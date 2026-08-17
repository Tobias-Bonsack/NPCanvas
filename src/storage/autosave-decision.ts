import type { AppState, ProjectFile } from '../project/types.ts'

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

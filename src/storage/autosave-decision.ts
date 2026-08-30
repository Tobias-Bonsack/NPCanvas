import { assertNever } from '../assert-never.ts'
import type { AppState, ProjectFile } from '../project/types.ts'

// Long enough that a burst of typing is one write, short enough that a user who alt-tabs away
// without triggering `visibilitychange` still loses under a second of work.
export const DEBOUNCE_MS = 800

// The most a debounce may ever delay a write past the first unwritten edit. DEBOUNCE_MS alone
// assumes a burst that ends — but a watcher recording re-arms it roughly every 300ms
// (capture-watch.ts) for as long as the conversation runs, so without this ceiling the one
// situation the app is designed to leave unattended is the one where nothing reaches disk.
export const MAX_UNSAVED_MS = 5000

// Never past MAX_UNSAVED_MS from the oldest unwritten edit — past the deadline this is 0,
// which the caller reads as "write immediately".
export function nextDebounceMs(oldestUnwrittenEditAt: number, now: number): number {
  const deadline = oldestUnwrittenEditAt + MAX_UNSAVED_MS
  return Math.max(0, Math.min(DEBOUNCE_MS, deadline - now))
}

// Split from the module that owns the timers/IO so the decisions can be tested at all (see
// CLAUDE.md § Testing scope) — nothing here reads a clock, touches a timer, or writes a file.
// Two functions, not one, because the debounce sits between them: a store change decides
// whether a write is coming, and the write later decides against a store that moved on.

type ChangeDecision =
  | { kind: 'drop' }
  | { kind: 'adopt'; project: ProjectFile }
  | { kind: 'ignore' }
  | { kind: 'schedule'; project: ProjectFile }

type WriteDecision =
  // At most one follow-up ever queues — it re-reads the current document when it runs, so any
  // number of edits during this write collapse into that pass.
  | { kind: 'queue' }
  | { kind: 'skip' }
  | { kind: 'write'; project: ProjectFile }

// previous is null both before the first load and after a disconnect.
export function decideOnStoreChange(
  state: AppState,
  previous: ProjectFile | null,
): ChangeDecision {
  if (state.kind !== 'ready') return { kind: 'drop' }
  if (previous === null) return { kind: 'adopt', project: state.project }
  // Reference identity, not a deep compare — the reducer returns the same object for every
  // action that didn't touch the document.
  if (previous === state.project) return { kind: 'ignore' }
  return { kind: 'schedule', project: state.project }
}

export function decideOnWrite(state: AppState, writeInFlight: boolean): WriteDecision {
  if (writeInFlight) return { kind: 'queue' }
  if (state.kind !== 'ready') return { kind: 'skip' }
  return { kind: 'write', project: state.project }
}

// What the unload warning asks. `failed` counts — it's the state where the edits are
// guaranteed absent from the folder.
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

// Narrower than hasUnsavedEdits. `saving` is excluded — the store already holds the document
// being written, since an edit mid-write moves state to `pending` instead. `failed` is
// included because no debounce timer survives a failed write.
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

import { useSyncExternalStore } from 'react'
import type { CaptureProfile, CaptureProfileId } from '../project/types.ts'

/**
 * Which capture profile the next capture will use.
 *
 * Not document state: a profile *belongs* to the project, but which of them is aimed at the
 * emulator right now is about this session, and writing it to `data.json` would make picking a
 * profile a save. Not component state either — `CaptureBar` unmounts whenever the settings
 * screen is navigated away from, and the dialogue panel's own capture button needs the same
 * answer without `CaptureBar` mounted at all. So it is a module-level store, for the same reason
 * `capture-session.ts` is one.
 */
let activeId: CaptureProfileId | null = null
const listeners = new Set<() => void>()

/** Passed to `useSyncExternalStore` by reference; the snapshot is an id, never an object. */
function getActiveId(): CaptureProfileId | null {
  return activeId
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setActiveCaptureProfileId(id: CaptureProfileId | null): void {
  if (id === activeId) return
  activeId = id
  for (const listener of listeners) listener()
}

/**
 * The active profile, resolved against the project's own list.
 *
 * Falls back to the first profile when nothing is chosen or the chosen one is gone — after a
 * reload the id is null while `data.json` still holds the profiles, and a capture bar that
 * showed "no profile" beside a project that has one would read as data loss.
 */
export function useActiveCaptureProfile(
  profiles: readonly CaptureProfile[],
): CaptureProfile | null {
  const id = useSyncExternalStore(subscribe, getActiveId)
  return resolveActiveProfile(profiles, id)
}

/**
 * The same answer outside React, for `capture-watch.ts` — its loop runs on a timer rather than in
 * a render, and reading the choice through a second rule would let the watcher and the button
 * capture with different profiles.
 */
export function activeCaptureProfile(
  profiles: readonly CaptureProfile[],
): CaptureProfile | null {
  return resolveActiveProfile(profiles, activeId)
}

function resolveActiveProfile(
  profiles: readonly CaptureProfile[],
  id: CaptureProfileId | null,
): CaptureProfile | null {
  return profiles.find((profile) => profile.id === id) ?? profiles[0] ?? null
}

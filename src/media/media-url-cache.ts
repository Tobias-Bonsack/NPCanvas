import { useCallback, useSyncExternalStore } from 'react'
import type { MediaFile } from '../project/types.ts'
import { describeError, readMediaFile } from '../storage/project-directory.ts'

// `missing` is a first-class outcome, not an error — the user may move or delete files in
// their own project folder between sessions.
export type MediaUrl =
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'missing' }
  | { kind: 'failed'; message: string }

// Object URLs are ref-counted with a deferred revoke, because pins mount and unmount
// constantly while panning and while thumbnails cull in/out of the visible rect — revoking at
// refcount zero would re-read the same file off disk several times a second.
const REVOKE_DELAY_MS = 30_000

const LOADING: MediaUrl = { kind: 'loading' }

type Entry = {
  refs: number
  state: MediaUrl
  listeners: Set<() => void>
  revokeTimer: ReturnType<typeof setTimeout> | null
  // Which read may publish. Incremented per startLoad, since the identity check in `load`
  // compares the entry object, which an invalidation leaves unchanged.
  load: number
}

// Keyed on file name alone: media/<id>.<ext> is content-stable by construction, so a new
// MediaFile object for the same file must never trigger a re-read. Re-importing over an
// existing dialogue goes through invalidateMediaFile instead.
const entries = new Map<string, Entry>()

// useSyncExternalStore, not useState+useEffect: the cache is an external store, and
// subscribe/cleanup on mount/unmount is exactly the acquire/release pair.
export function useMediaUrl(file: MediaFile): MediaUrl {
  const fileName = file.fileName

  const subscribe = useCallback(
    (onChange: () => void) => {
      const entry = acquire(fileName)
      entry.listeners.add(onChange)
      return () => {
        entry.listeners.delete(onChange)
        release(fileName)
      }
    },
    [fileName],
  )

  // Must return a stable reference for an unchanged state, or React re-renders forever.
  const getSnapshot = useCallback(() => entries.get(fileName)?.state ?? LOADING, [fileName])

  return useSyncExternalStore(subscribe, getSnapshot)
}

// A re-import writes the same derived file name with new bytes, so callers must drop the
// cached URL for it explicitly.
export function invalidateMediaFile(fileName: string): void {
  const entry = entries.get(fileName)
  if (entry === undefined) return

  if (entry.refs === 0) {
    revokeUrl(entry)
    cancelRevoke(entry)
    entries.delete(fileName)
    return
  }
  setState(entry, LOADING)
  startLoad(fileName, entry)
}

// Invalidates each entry rather than clearing the map, so a mounted reader re-reads against
// the newly connected folder instead of being stranded on a stale `ready` snapshot.
export function clearMediaCache(): void {
  for (const fileName of [...entries.keys()]) invalidateMediaFile(fileName)
}

function acquire(fileName: string): Entry {
  const existing = entries.get(fileName)
  if (existing !== undefined) {
    // A re-acquire inside the deferred-revoke window keeps the URL alive.
    cancelRevoke(existing)
    existing.refs += 1
    return existing
  }

  const entry: Entry = {
    refs: 1,
    state: LOADING,
    listeners: new Set(),
    revokeTimer: null,
    load: 0,
  }
  entries.set(fileName, entry)
  startLoad(fileName, entry)
  return entry
}

function release(fileName: string): void {
  const entry = entries.get(fileName)
  if (entry === undefined) return
  entry.refs -= 1
  if (entry.refs > 0) return

  cancelRevoke(entry)
  entry.revokeTimer = setTimeout(() => {
    revokeUrl(entry)
    // Guarded: invalidateMediaFile may have replaced this entry under the same name already.
    if (entries.get(fileName) === entry) entries.delete(fileName)
  }, REVOKE_DELAY_MS)
}

function startLoad(fileName: string, entry: Entry): void {
  entry.load += 1
  void load(fileName, entry, entry.load)
}

async function load(fileName: string, entry: Entry, token: number): Promise<void> {
  try {
    const found = await readMediaFile(fileName)
    // A superseded read must not publish a URL nothing will ever hold a reference to.
    if (isStale(fileName, entry, token)) return
    setState(entry, found === null ? { kind: 'missing' } : { kind: 'ready', url: URL.createObjectURL(found) })
  } catch (error) {
    if (isStale(fileName, entry, token)) return
    setState(entry, { kind: 'failed', message: describeError(error) })
  }
}

function isStale(fileName: string, entry: Entry, token: number): boolean {
  return entries.get(fileName) !== entry || entry.load !== token
}

function setState(entry: Entry, state: MediaUrl): void {
  // The only place a `ready` state is replaced, so revoking here can't miss a case.
  revokeUrl(entry)
  entry.state = state
  for (const listener of entry.listeners) listener()
}

function cancelRevoke(entry: Entry): void {
  if (entry.revokeTimer === null) return
  clearTimeout(entry.revokeTimer)
  entry.revokeTimer = null
}

function revokeUrl(entry: Entry): void {
  if (entry.state.kind !== 'ready') return
  URL.revokeObjectURL(entry.state.url)
}

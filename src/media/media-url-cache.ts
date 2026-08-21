import { useCallback, useSyncExternalStore } from 'react'
import type { MediaFile } from '../project/types.ts'
import { describeError, readMediaFile } from '../storage/project-directory.ts'

/**
 * `missing` is a first-class outcome, not an error: the user owns the project folder and
 * may move or delete files in it between sessions. A pin whose media vanished should say
 * so, not throw.
 */
export type MediaUrl =
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'missing' }
  | { kind: 'failed'; message: string }

/**
 * How long a URL survives its last reader.
 *
 * Revoking at refcount zero would thrash: pins mount and unmount constantly while panning
 * and while thumbnails cull in and out of the visible rect, so the same file would be read
 * off disk several times a second. Thirty seconds is long enough that a pan across a map and
 * back costs nothing, short enough that abandoned media does not pin its bytes for a session.
 */
const REVOKE_DELAY_MS = 30_000

/** Shared reference, so an unacquired file keeps returning the identical snapshot. */
const LOADING: MediaUrl = { kind: 'loading' }

type Entry = {
  /** Live readers. Zero means the revoke below is scheduled, not that the entry is gone. */
  refs: number
  state: MediaUrl
  listeners: Set<() => void>
  revokeTimer: ReturnType<typeof setTimeout> | null
  /**
   * Which read is allowed to publish. Incremented by every `startLoad`, because the identity
   * check in `load` compares the entry *object*, which an invalidation leaves unchanged — two
   * reads for one entry would both pass it and the URL published first would be overwritten
   * without ever being revoked.
   */
  load: number
}

// Keyed on the file name alone: `media/<id>.<ext>` is content-stable by construction, so a
// new `MediaFile` object describing the same file must never trigger a re-read. The one case
// where a name *does* get new bytes — re-importing over an existing dialogue — goes through
// `invalidateMediaFile`.
const entries = new Map<string, Entry>()

/**
 * The object URL for a file in `media/`, ref-counted across every component that asks for it.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the cache *is* an external
 * store, and `subscribe` running on mount and its cleanup on unmount is exactly the
 * acquire/release pair. StrictMode's double-invoked effects therefore net out to one
 * reference — the release schedules a revoke and the immediate re-acquire cancels it.
 */
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

/**
 * Drops the cached bytes for a file whose contents just changed on disk.
 *
 * Necessary because the cache key is the file name and a re-import writes the *same* name —
 * `media/<dialogueId>-<mediaId>.<ext>` is derived from ids, not from the upload. Without this,
 * every
 * reader would keep showing the previous picture until its refcount happened to expire.
 */
export function invalidateMediaFile(fileName: string): void {
  const entry = entries.get(fileName)
  if (entry === undefined) return

  if (entry.refs === 0) {
    // Nothing is watching, so there is no one to re-read for. The scheduled revoke would
    // only free an already-revoked URL, and the next acquire must start clean.
    revokeUrl(entry)
    cancelRevoke(entry)
    entries.delete(fileName)
    return
  }
  // `setState` revokes what it replaces, so the previous URL is freed here rather than left
  // to the read that is about to supersede it.
  setState(entry, LOADING)
  startLoad(fileName, entry)
}

/**
 * Drops every cached URL, for a switch to a different project folder.
 *
 * Necessary precisely because entries are keyed on the file name alone while `readMediaFile`
 * resolves against whatever folder is connected *now*: a copied project folder holds the same
 * names with different bytes, so without this the new project renders the old one's pictures —
 * for the length of the revoke delay, and indefinitely for any reader still mounted.
 *
 * Invalidating each entry rather than clearing the map, so a mounted reader is re-read against
 * the new folder instead of being stranded on a `loading` snapshot nothing will ever update.
 */
export function clearMediaCache(): void {
  for (const fileName of [...entries.keys()]) invalidateMediaFile(fileName)
}

function acquire(fileName: string): Entry {
  const existing = entries.get(fileName)
  if (existing !== undefined) {
    // A re-acquire inside the deferred-revoke window keeps the URL alive; this is the case
    // the whole delay exists for.
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
    // Guarded: `invalidateMediaFile` may already have replaced this entry with a fresh one
    // under the same name, and deleting that would strand its readers on a dead URL.
    if (entries.get(fileName) === entry) entries.delete(fileName)
  }, REVOKE_DELAY_MS)
}

/** The only way to start a read: the token is what stops a superseded one from publishing. */
function startLoad(fileName: string, entry: Entry): void {
  entry.load += 1
  void load(fileName, entry, entry.load)
}

async function load(fileName: string, entry: Entry, token: number): Promise<void> {
  try {
    const found = await readMediaFile(fileName)
    // The entry may have expired, or a newer read superseded this one, while the read was in
    // flight; creating a URL then would leak one nothing holds a reference to.
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
  // Revoked here rather than at the call sites: this is the only place a `ready` state is ever
  // replaced, and a URL nothing holds pins its file's bytes for the life of the tab.
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

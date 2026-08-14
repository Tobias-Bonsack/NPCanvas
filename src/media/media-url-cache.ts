import { useEffect, useState } from 'react'
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
 * Reads a file out of `media/` and hands back an object URL for its lifetime.
 *
 * Deliberately naive for now — one read and one `createObjectURL` per mount, revoked on
 * unmount. #12 replaces the body with the ref-counted cache and 30 s deferred revoke that
 * pins need, because pins remount constantly while panning. The signature is the contract;
 * callers do not change when that lands.
 */
export function useMediaUrl(file: MediaFile): MediaUrl {
  const [state, setState] = useState<MediaUrl>({ kind: 'loading' })
  // Keyed on the name alone: `media/<id>.<ext>` is content-stable by construction, so a new
  // `MediaFile` object describing the same file must not trigger a re-read.
  const fileName = file.fileName

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setState({ kind: 'loading' })

    void (async () => {
      try {
        const found = await readMediaFile(fileName)
        if (cancelled) return
        if (found === null) {
          setState({ kind: 'missing' })
          return
        }
        objectUrl = URL.createObjectURL(found)
        setState({ kind: 'ready', url: objectUrl })
      } catch (error) {
        if (!cancelled) setState({ kind: 'failed', message: describeError(error) })
      }
    })()

    return () => {
      cancelled = true
      // Null whenever cleanup wins the race, and in that case the `cancelled` check above
      // returns before any URL is created — so there is nothing left to leak either way.
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [fileName])

  return state
}

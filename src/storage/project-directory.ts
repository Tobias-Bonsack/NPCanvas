import { assertNever } from '../assert-never.ts'
import { createEmptyProject } from '../project/data-file.ts'
import { dispatch } from '../project/store.ts'
import {
  clearDirectoryHandle,
  readDirectoryHandle,
  saveDirectoryHandle,
} from './directory-handle-store.ts'
import { isFileSystemAccessSupported } from './file-system-support.ts'

// Every export here awaits IO and then dispatches plain actions, one per step. Nothing
// asynchronous ever reaches the reducer: no thunks, no middleware, no promises in state.

/**
 * The live handle for the connected project folder. Module-level rather than in the store
 * because it is not renderable state and not serializable — the store holds the document.
 */
let directoryHandle: FileSystemDirectoryHandle | null = null

/** Boot entry point, called once from `main.tsx`. */
export async function startProjectConnection(): Promise<void> {
  if (!isFileSystemAccessSupported()) {
    dispatch({ kind: 'project/unsupported' })
    return
  }
  await restoreSavedDirectory()
}

/** Must be called from a click handler — see the `showDirectoryPicker` comment below. */
export async function connectToNewDirectory(): Promise<void> {
  let handle: FileSystemDirectoryHandle
  try {
    // Requires transient user activation, so this must be the first await in the click
    // handler's task. `id` makes Chromium reopen the picker where it was last left.
    handle = await window.showDirectoryPicker({ id: 'npcanvas-project', mode: 'readwrite' })
  } catch (error) {
    // Every picker rejection ends with no folder chosen, which *is* `disconnected`.
    // Cancelling (AbortError) is an ordinary outcome and stays silent; anything else is a
    // bug worth a console trace, but still not a `load-failed` — there is no folder whose
    // reading could be retried.
    if (!isAbortError(error)) console.error('Folder picker failed', error)
    dispatch({ kind: 'project/disconnected' })
    return
  }

  try {
    await saveDirectoryHandle(handle)
  } catch (error) {
    // Losing the handle only costs a re-pick after reload; the session itself is fine.
    console.error('Could not remember the project folder for next time', error)
  }
  await openProject(handle)
}

/** Boot path: reuse the folder from the previous session if the grant is still good. */
export async function restoreSavedDirectory(): Promise<void> {
  let handle: FileSystemDirectoryHandle | null = null
  try {
    handle = await readDirectoryHandle()
  } catch (error) {
    console.error('Could not read the remembered project folder', error)
  }
  if (handle === null) {
    dispatch({ kind: 'project/disconnected' })
    return
  }

  const permission = await handle.queryPermission({ mode: 'readwrite' })
  switch (permission) {
    case 'granted':
      await openProject(handle)
      return

    case 'prompt':
      // Hold the handle so the Reconnect click can call requestPermission immediately,
      // without an IndexedDB round trip that would spend the user gesture first.
      directoryHandle = handle
      dispatch({ kind: 'project/reconnecting', directoryName: handle.name })
      return

    case 'denied':
      // A denied grant is permanent for this origin+folder, so the stored handle is dead
      // weight that would otherwise show a Reconnect button that can never succeed.
      await clearDirectoryHandle().catch(() => undefined)
      dispatch({ kind: 'project/disconnected' })
      return

    default:
      return assertNever(permission)
  }
}

/** Must be called from a click handler — see the `requestPermission` comment below. */
export async function grantSavedDirectoryAccess(): Promise<void> {
  const handle = directoryHandle
  if (handle === null) {
    dispatch({ kind: 'project/disconnected' })
    return
  }

  // requestPermission silently resolves to the *current* state instead of prompting when
  // it runs outside a user gesture. It must therefore be the first await in the click
  // handler's task, and this function must never be called from an effect or a timer.
  const permission = await handle.requestPermission({ mode: 'readwrite' })
  if (permission !== 'granted') {
    dispatch({
      kind: 'project/load-failed',
      directoryName: handle.name,
      message: 'Access to this folder was not granted. Pick the folder again to continue.',
    })
    return
  }
  await openProject(handle)
}

async function openProject(handle: FileSystemDirectoryHandle): Promise<void> {
  directoryHandle = handle
  dispatch({ kind: 'project/loading', directoryName: handle.name })
  // #5 replaces this with a real read of <folder>/data.json. Until then a connected folder
  // yields an empty in-memory project so the rest of the app stays reachable.
  dispatch({
    kind: 'project/loaded',
    directoryName: handle.name,
    project: createEmptyProject(handle.name),
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

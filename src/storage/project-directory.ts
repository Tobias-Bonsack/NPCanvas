import { assertNever } from '../assert-never.ts'
import { createEmptyProject, parseProjectFile, serializeProject } from '../project/data-file.ts'
import { dispatch } from '../project/store.ts'
import type { ProjectFile } from '../project/types.ts'
import {
  clearDirectoryHandle,
  readDirectoryHandle,
  saveDirectoryHandle,
} from './directory-handle-store.ts'
import { isFileSystemAccessSupported } from './file-system-support.ts'

// Every export here awaits IO and then dispatches plain actions, one per step. Nothing
// asynchronous ever reaches the reducer: no thunks, no middleware, no promises in state.

const DATA_FILE_NAME = 'data.json'
const MEDIA_DIRECTORY_NAME = 'media'

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

/**
 * Opens the folder picker and adopts what the user chooses — the first connect and a switch
 * between projects are the same act. Resolves to whether a folder was actually opened, so a
 * caller can follow up (the switch navigates) without reading the store back.
 *
 * Must be called from a click handler — see the `showDirectoryPicker` comment below.
 */
export async function connectToNewDirectory(): Promise<boolean> {
  let handle: FileSystemDirectoryHandle
  try {
    // Requires transient user activation, so this must be the first await in the click
    // handler's task. `id` makes Chromium reopen the picker where it was last left.
    handle = await window.showDirectoryPicker({ id: 'npcanvas-project', mode: 'readwrite' })
  } catch (error) {
    // Every picker rejection ends with no folder chosen. What that means depends on whether
    // a project was already open, which is the reducer's decision — not this module's.
    // Cancelling (AbortError) is an ordinary outcome and stays silent; anything else is a
    // bug worth a console trace, but still not a `load-failed` — there is no folder whose
    // reading could be retried.
    if (!isAbortError(error)) console.error('Folder picker failed', error)
    dispatch({ kind: 'project/pick-cancelled' })
    return false
  }

  try {
    await saveDirectoryHandle(handle)
  } catch (error) {
    // Losing the handle only costs a re-pick after reload; the session itself is fine.
    console.error('Could not remember the project folder for next time', error)
  }
  await openProject(handle)
  return true
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

/**
 * Writes `data.json`, resolving to the timestamp to show as "saved at".
 *
 * `createWritable()` already writes through a swap file and commits atomically on
 * `close()`, so there is deliberately no tmp-file-plus-rename scheme layered on top.
 */
export async function writeProjectFile(project: ProjectFile): Promise<string> {
  const handle = directoryHandle
  if (handle === null) throw new Error('No project folder is connected')

  const fileHandle = await handle.getFileHandle(DATA_FILE_NAME, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(serializeProject(project))
    await writable.close()
  } catch (error) {
    // abort(), not close(): close() would commit the half-written swap file over the
    // user's data. A failure to abort is not worth masking the original error.
    await writable.abort().catch(() => undefined)
    throw error
  }
  // Within a millisecond of the `savedAt` that `serializeProject` stamped into the file.
  // Reading it back out of the JSON just to display it is not worth the parse.
  return new Date().toISOString()
}

// ---- media/ ----
//
// Every media file the app writes is named from an id it generated, never from the upload's
// filename, so nothing here needs to sanitise a path. See CLAUDE.md § Media contract.

/** Writes (or overwrites) `media/<fileName>`, creating `media/` on first use. */
export async function writeMediaFile(fileName: string, data: Blob): Promise<void> {
  const media = await getMediaDirectory({ create: true })
  const fileHandle = await media.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(data)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}

/**
 * Resolves to `null` when the file is absent, which is an expected state — the user can
 * delete or move files in their own project folder between sessions.
 */
export async function readMediaFile(fileName: string): Promise<File | null> {
  const media = await getMediaDirectory({ create: false })
  if (media === null) return null
  try {
    return await (await media.getFileHandle(fileName)).getFile()
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

/** Deleting an already-absent file is success: the caller wanted it gone, and it is. */
export async function deleteMediaFile(fileName: string): Promise<void> {
  const media = await getMediaDirectory({ create: false })
  if (media === null) return
  try {
    await media.removeEntry(fileName)
  } catch (error) {
    if (!isNotFoundError(error)) throw error
  }
}

async function getMediaDirectory(options: { create: true }): Promise<FileSystemDirectoryHandle>
async function getMediaDirectory(options: {
  create: false
}): Promise<FileSystemDirectoryHandle | null>
async function getMediaDirectory(options: {
  create: boolean
}): Promise<FileSystemDirectoryHandle | null> {
  const handle = directoryHandle
  if (handle === null) throw new Error('No project folder is connected')
  try {
    return await handle.getDirectoryHandle(MEDIA_DIRECTORY_NAME, { create: options.create })
  } catch (error) {
    // Only reachable with create: false — a read against a project that has no media yet.
    if (isNotFoundError(error)) return null
    throw error
  }
}

async function openProject(handle: FileSystemDirectoryHandle): Promise<void> {
  directoryHandle = handle
  dispatch({ kind: 'project/loading', directoryName: handle.name })
  try {
    const project = await readOrCreateProjectFile(handle)
    dispatch({ kind: 'project/loaded', directoryName: handle.name, project })
  } catch (error) {
    dispatch({
      kind: 'project/load-failed',
      directoryName: handle.name,
      message: describeError(error),
    })
  }
}

async function readOrCreateProjectFile(handle: FileSystemDirectoryHandle): Promise<ProjectFile> {
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await handle.getFileHandle(DATA_FILE_NAME)
  } catch (error) {
    if (!isNotFoundError(error)) throw error
    // A folder without data.json is a new project, not a failure. Write it immediately so
    // the folder is never left half-adopted — with nothing on disk, a reload that restores
    // the handle would find an empty folder and bootstrap a *second* empty project.
    const project = createEmptyProject(handle.name)
    await writeProjectFile(project)
    return project
  }

  const text = await (await fileHandle.getFile()).text()
  const result = parseProjectFile(text)
  if (!result.ok) throw new Error(result.message)
  return result.file
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

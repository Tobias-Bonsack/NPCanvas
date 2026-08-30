import { assertNever } from '../assert-never.ts'
import { clearMediaCache } from '../media/media-url-cache.ts'
import { createEmptyProject, parseProjectFile, serializeProject } from '../project/data-file.ts'
import { dispatch } from '../project/store.ts'
import type { ProjectFile, ProjectRepairs } from '../project/types.ts'
import {
  clearDirectoryHandle,
  readDirectoryHandle,
  saveDirectoryHandle,
} from './directory-handle-store.ts'
import { isFileSystemAccessSupported } from './file-system-support.ts'

// Async IO never reaches the reducer: each export awaits, then dispatches a plain action.

const DATA_FILE_NAME = 'data.json'
const BACKUP_FILE_NAME = 'data.json.bak'
const MEDIA_DIRECTORY_NAME = 'media'

// Only the first write of a session backs up what was on disk when the session started, so a
// bad edit stays recoverable even after many autosaves. Reset on every openProject.
let backedUpThisSession = false

let directoryHandle: FileSystemDirectoryHandle | null = null

// Two loads can race (boot restore vs. a picker click) — every dispatch on the load path is
// gated on the generation it started under, so a slower finisher can't win.
let loadGeneration = 0

function beginLoad(): number {
  loadGeneration += 1
  return loadGeneration
}

function isCurrentLoad(generation: number): boolean {
  return generation === loadGeneration
}

export async function startProjectConnection(): Promise<void> {
  if (!isFileSystemAccessSupported()) {
    dispatch({ kind: 'project/unsupported' })
    return
  }
  await restoreSavedDirectory()
}

// Resolves to whether a folder was actually opened, so a caller (the connect/switch flow) can
// follow up without reading the store back. Must run in a click handler: showDirectoryPicker
// needs transient user activation, so this must be its first await.
export async function connectToNewDirectory(): Promise<boolean> {
  let handle: FileSystemDirectoryHandle
  try {
    // `id` makes Chromium reopen the picker where it was last left.
    handle = await window.showDirectoryPicker({ id: 'npcanvas-project', mode: 'readwrite' })
  } catch (error) {
    // Cancelling (AbortError) is ordinary; anything else is worth a console trace.
    if (!isAbortError(error)) console.error('Folder picker failed', error)
    dispatch({ kind: 'project/pick-cancelled' })
    return false
  }
  await openProject(handle)
  return true
}

async function restoreSavedDirectory(): Promise<void> {
  const generation = beginLoad()

  let handle: FileSystemDirectoryHandle | null = null
  try {
    handle = await readDirectoryHandle()
  } catch (error) {
    console.error('Could not read the remembered project folder', error)
  }
  if (!isCurrentLoad(generation)) return
  if (handle === null) {
    dispatch({ kind: 'project/disconnected' })
    return
  }

  let permission: PermissionState
  try {
    // A folder deleted/renamed since last session rejects here; ErrorBoundary can't help (it
    // catches render, not a rejected promise from this boot-time call), so it's caught explicitly.
    permission = await handle.queryPermission({ mode: 'readwrite' })
  } catch (error) {
    if (isCurrentLoad(generation)) {
      dispatch({
        kind: 'project/load-failed',
        directoryName: handle.name,
        message: describeError(error),
      })
    }
    return
  }
  if (!isCurrentLoad(generation)) return

  switch (permission) {
    case 'granted':
      await openProject(handle)
      return

    case 'prompt':
      // Held so the Reconnect click can requestPermission immediately, without an IndexedDB
      // round trip that would spend the user gesture first.
      directoryHandle = handle
      dispatch({ kind: 'project/reconnecting', directoryName: handle.name })
      return

    case 'denied':
      // Permanent for this origin+folder — the stored handle can only ever show a dead-end
      // Reconnect button, so it's dropped now.
      await clearDirectoryHandle().catch(() => undefined)
      if (isCurrentLoad(generation)) dispatch({ kind: 'project/disconnected' })
      return

    default:
      return assertNever(permission)
  }
}

// requestPermission only prompts under transient user activation — outside a gesture it just
// resolves to the current state. Must be the first await in a click handler's task.
export async function grantSavedDirectoryAccess(): Promise<void> {
  const handle = directoryHandle
  if (handle === null) {
    dispatch({ kind: 'project/disconnected' })
    return
  }

  const permission = await handle.requestPermission({ mode: 'readwrite' })
  switch (permission) {
    case 'granted':
      await openProject(handle)
      return

    case 'prompt':
      // Dismissed, not refused (Escape or an outside click) — Chromium reports this as
      // `prompt` too. The handle is still good; the next click prompts again.
      dispatch({ kind: 'project/reconnecting', directoryName: handle.name })
      return

    case 'denied':
      // Chromium remembers a refusal for this origin+folder: the next requestPermission
      // resolves to `denied` without prompting, and it survives reloads. Drop the handle so
      // the picker — not a dead-end Reconnect button — is the way back.
      directoryHandle = null
      await clearDirectoryHandle().catch(() => undefined)
      dispatch({
        kind: 'project/load-failed',
        directoryName: handle.name,
        message: 'Access to this folder was not granted. Pick the folder again to continue.',
      })
      return

    default:
      return assertNever(permission)
  }
}

// Re-asks for write access to the already-open folder: Chromium can revoke a readwrite grant
// mid-session (the omnibox file-access chip does this), after which every write throws
// NotAllowedError until re-granted. Must run in a click handler, per requestPermission above.
export async function regrantConnectedDirectory(): Promise<boolean> {
  const handle = directoryHandle
  if (handle === null) return false
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
}

export async function writeProjectFile(project: ProjectFile): Promise<string> {
  const handle = directoryHandle
  if (handle === null) throw new Error('No project folder is connected')
  await backUpBeforeFirstWrite(handle)
  await writeDataFile(handle, project)
  return new Date().toISOString()
}

// A folder with no data.json yet has nothing to back up — that's bootstrapped separately by
// readOrCreateProjectFile, which is success, not a missing case here.
async function backUpBeforeFirstWrite(handle: FileSystemDirectoryHandle): Promise<void> {
  if (backedUpThisSession) return
  backedUpThisSession = true
  let existing: File
  try {
    existing = await (await handle.getFileHandle(DATA_FILE_NAME)).getFile()
  } catch (error) {
    if (isNotFoundError(error)) return
    throw error
  }
  await writeTextFile(handle, BACKUP_FILE_NAME, await existing.text())
}

async function writeDataFile(
  handle: FileSystemDirectoryHandle,
  project: ProjectFile,
): Promise<void> {
  await writeTextFile(handle, DATA_FILE_NAME, serializeProject(project))
}

async function writeTextFile(
  handle: FileSystemDirectoryHandle,
  name: string,
  contents: string,
): Promise<void> {
  const fileHandle = await handle.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(contents)
    await writable.close()
  } catch (error) {
    // abort(), not close() — close() would commit the half-written swap file over the user's data.
    await writable.abort().catch(() => undefined)
    throw error
  }
}

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

// Resolves to null when the file is absent — expected, since the user can delete or move
// files in their own project folder between sessions.
export async function readMediaFile(fileName: string): Promise<File | null> {
  const media = await getMediaDirectory({ create: false })
  if (media === null) return null
  try {
    return await (await media.getFileHandle(fileName)).getFile()
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

// Deleting an already-absent file is success: the caller wanted it gone, and it is.
export async function deleteMediaFile(fileName: string): Promise<void> {
  const media = await getMediaDirectory({ create: false })
  if (media === null) return
  try {
    await media.removeEntry(fileName)
  } catch (error) {
    if (!isMissingFile(error)) throw error
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
    if (isNotFoundError(error)) return null
    throw error
  }
}

async function openProject(handle: FileSystemDirectoryHandle): Promise<void> {
  const generation = beginLoad()
  directoryHandle = handle
  backedUpThisSession = false
  // After the handle, never before — the cache is keyed on file name alone, so a copied
  // project folder with the same names but other bytes must not resolve against the old one.
  clearMediaCache()
  dispatch({ kind: 'project/loading', directoryName: handle.name })

  let loaded: LoadedProject
  try {
    loaded = await readOrCreateProjectFile(handle)
  } catch (error) {
    if (isCurrentLoad(generation)) {
      dispatch({
        kind: 'project/load-failed',
        directoryName: handle.name,
        message: describeError(error),
      })
    }
    return
  }
  if (!isCurrentLoad(generation)) return
  dispatch({ kind: 'project/loaded', directoryName: handle.name, ...loaded })

  // Remembered only now the load has won, so a reload never lands on a folder whose
  // data.json didn't parse.
  try {
    await saveDirectoryHandle(handle)
  } catch (error) {
    // Losing the handle only costs a re-pick after reload; the session itself is fine.
    console.error('Could not remember the project folder for next time', error)
  }
}

type LoadedProject = { project: ProjectFile; repairs: ProjectRepairs }

async function readOrCreateProjectFile(
  handle: FileSystemDirectoryHandle,
): Promise<LoadedProject> {
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await handle.getFileHandle(DATA_FILE_NAME)
  } catch (error) {
    if (!isNotFoundError(error)) throw error
    // A folder without data.json is a new project, not a failure — write it immediately so a
    // reload doesn't find an empty folder and bootstrap a second empty project. Through the
    // passed-in `handle`, not the module-level one, in case a second load has since replaced it.
    const project = createEmptyProject(handle.name)
    await writeDataFile(handle, project)
    return { project, repairs: { kind: 'none' } }
  }

  const text = await (await fileHandle.getFile()).text()
  const result = parseProjectFile(text)
  if (!result.ok) throw new Error(result.message)
  return { project: result.file, repairs: result.repairs }
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

// A hand-edited fileName containing `/`, `.` or `..` rejects with a plain TypeError ("Name is
// not allowed"), not NotFoundError — treated as missing (not a hard failure) for read/delete
// only; a write under such a name is a real failure and must still throw.
function isMissingFile(error: unknown): boolean {
  return isNotFoundError(error) || error instanceof TypeError
}

// Distinguishes a lost/refused readwrite grant from a disk/quota/serialisation failure — the
// caller offers a permission prompt for one and a plain retry for the other.
export function isPermissionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError'
}

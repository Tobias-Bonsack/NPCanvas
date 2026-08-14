// lib.dom.d.ts (TS 5.8) ships the File System Access *handle* interfaces but not the entry
// point, the permission methods, or async directory iteration. Everything below is an
// interface **augmentation**: `FileSystemHandle`, `FileSystemDirectoryHandle`,
// `FileSystemFileHandle` and `FileSystemWritableFileStream` already exist globally, so
// declaring them afresh would be a duplicate-identifier error rather than an override.
// This is also why `@types/wicg-file-system-access` is not installed — it redefines them.
//
// No top-level import/export: this must stay a global script file. `moduleDetection: force`
// only applies to non-declaration files, so declaration files are unaffected.

/** `PermissionState` and `FileSystemHandleKind` come from lib.dom; this descriptor does not. */
interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface DirectoryPickerOptions {
  /** Chromium remembers the last directory per id, so the picker reopens where it left off. */
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?:
    | FileSystemHandle
    | 'desktop'
    | 'documents'
    | 'downloads'
    | 'music'
    | 'pictures'
    | 'videos'
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
  /** Silently resolves to the current state unless called inside a user gesture. */
  requestPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  // Also declared by lib.dom.asynciterable.d.ts, which `tsconfig.app.json` does not load
  // (its `lib` is ES2022 + DOM + DOM.Iterable). Declaring it here keeps the lib list minimal.
  values(): AsyncIterableIterator<FileSystemHandle>
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
}

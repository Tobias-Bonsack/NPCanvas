// lib.dom.d.ts (TS 5.8) ships `MediaDevices.getDisplayMedia` and `DisplayMediaStreamOptions`,
// but that options bag carries only `audio` and `video` — the surface-selection controls the
// Screen Capture spec added later are missing. What follows is an interface **augmentation**:
// `DisplayMediaStreamOptions` already exists globally, so declaring it afresh merges the two
// rather than overriding one, exactly as `src/storage/file-system-access.d.ts` does for the
// File System Access handles.
//
// No top-level import/export: this must stay a global script file. `moduleDetection: force`
// only applies to non-declaration files, so declaration files are unaffected.

interface DisplayMediaStreamOptions {
  /** `exclude` keeps NPCanvas's own tab out of the picker, so it cannot capture itself. */
  selfBrowserSurface?: 'include' | 'exclude'
  /** `include` gives Chrome's own bar a "Share this tab instead" control mid-session. */
  surfaceSwitching?: 'include' | 'exclude'
  /** `include` offers whole monitors, not only windows and tabs. */
  monitorTypeSurfaces?: 'include' | 'exclude'
}

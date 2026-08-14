/**
 * Feature detection, never user-agent sniffing: the gate tests the exact API the app needs,
 * so a browser that ships it later works without a code change here — and a Chromium build
 * that lacks it (insecure origin, embedded webview) is correctly refused.
 */
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window
}

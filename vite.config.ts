// `vitest/config` re-exports Vite's own defineConfig widened with the `test` key. Importing
// it from 'vite' instead type-errors on `test`, and adding vitest to `types` would then be
// needed to fix it — this is the one-line version.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Deployed at https://tobias-bonsack.github.io/NPCanvas/, so assets need the
// repo name as base path. Dev server stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/NPCanvas/' : '/',
  plugins: [react()],
  // 'node', not 'jsdom': only pure functions are under test. See CLAUDE.md § Testing.
  test: { environment: 'node' },
}))

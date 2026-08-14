import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed at https://tobias-bonsack.github.io/NPCanvas/, so assets need the
// repo name as base path. Dev server stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/NPCanvas/' : '/',
  plugins: [react()],
}))

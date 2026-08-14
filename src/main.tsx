import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { startAutosave } from './storage/autosave.ts'
import { startProjectConnection } from './storage/project-directory.ts'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('index.html is missing the #root mount point')

// Module scope, not effects: both must run exactly once, and StrictMode double-invokes
// effects in development. They dispatch into the store, which the tree is already reading.
// Autosave subscribes first so it observes the load and adopts it as its clean baseline.
startAutosave()
void startProjectConnection()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

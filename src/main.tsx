import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { startProjectConnection } from './storage/project-directory.ts'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('index.html is missing the #root mount point')

// Module scope, not an effect: this must run exactly once, and StrictMode double-invokes
// effects in development. It dispatches into the store, which the tree is already reading.
void startProjectConnection()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

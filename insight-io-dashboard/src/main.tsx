import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const rootEl = document.getElementById('root')!

try {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (error) {
  rootEl.innerHTML = `<pre style="padding:16px;color:#fca5a5;background:#111827;white-space:pre-wrap;">${error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)}</pre>`
  throw error
}

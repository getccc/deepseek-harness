/** Mount the administration console. */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { LocaleProvider } from './locale.tsx'
import './main.css'

const host = document.getElementById('root')
if (host === null) throw new Error('team-admin: the page has no #root to mount in')

createRoot(host).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
)

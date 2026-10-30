import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from './config/app'

document.title = `${APP_NAME} — ${APP_TAGLINE}`
document
  .querySelector('meta[name="description"]')
  ?.setAttribute('content', APP_DESCRIPTION)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

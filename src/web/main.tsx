import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyThemePreference, readThemePreference } from './ui/theme'
import './ui/tokens.css'
import './ui/alice-ui.css'
import './styles.css'
import './shell/shell.css'
import './tasks/tasks.css'
import './pads/pads.css'
import './pages/pages.css'

// ใส่ธีมที่เลือกไว้ก่อน render แรก ไม่ให้จอกระพริบเป็นธีมอื่น
applyThemePreference(readThemePreference())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

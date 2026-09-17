import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CompanionView } from './CompanionView.tsx'

const isCompanion = new URLSearchParams(window.location.search).get('companion') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isCompanion ? <CompanionView /> : <App />}</StrictMode>,
)

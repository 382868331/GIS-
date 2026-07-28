import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ModalHost } from './components/ModalHost.tsx'
import { GlobalStateProvider } from './state/GlobalStateProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalStateProvider>
      <App />
      <ModalHost />
    </GlobalStateProvider>
  </StrictMode>,
)

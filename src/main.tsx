import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installKoraBridge } from '../shell/tauri-shim'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/global.css'

/**
 * Renderer entry point — one bundle for both shells.
 *
 * `installKoraBridge()` must run *before* `App` mounts, and that ordering is the whole
 * contract: under Tauri nothing has defined `window.kora` yet, and every component reaches
 * for it on first render. Under Electron the call is a no-op, since `preload.ts` already
 * installed the real bridge.
 */
installKoraBridge()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
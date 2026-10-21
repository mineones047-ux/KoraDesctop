import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Wrapper for the app root so a crash inside any component shows what happened
 * instead of a silent white screen. A class component on purpose — it is the only
 * React feature that can catch a render-time error.
 *
 * The fallback text is bilingual by hand: `useI18n` is a hook, and hooks cannot run
 * inside a crashed tree, so there is no locale context to use here.
 */
interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only log available in the renderer; kora's own window
    // handler (electron/main) does not see component crashes.
    console.error('[Kora] Renderer crashed:', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 p-8 bg-kora-bg text-kora-text text-center">
        <h1 className="text-xl font-semibold">Something went wrong / Что-то сломалось</h1>
        <pre className="max-w-xl overflow-auto bg-kora-card border border-kora-border rounded-xl p-4 text-xs text-kora-muted whitespace-pre-wrap">
          {error.message}
          {error.stack ? `\n\n${error.stack.slice(0, 2000)}` : ''}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          className="px-4 py-2 rounded-xl bg-kora-accent-soft text-kora-text font-medium hover:bg-kora-accent/30 transition-colors"
        >
          Try again / Попробовать снова
        </button>
      </div>
    )
  }
}

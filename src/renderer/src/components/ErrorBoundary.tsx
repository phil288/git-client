import { Component, type ErrorInfo as ReactErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface State {
  error: Error | null
}

/** Keeps one broken view from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ReactErrorInfo): void {
    console.error('View crashed:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" data-testid="error-boundary">
        <AlertTriangle className="size-6 text-danger" />
        <div className="font-medium">{this.props.label ?? 'This view'} hit an unexpected error.</div>
        <pre className="selectable max-h-40 max-w-2xl overflow-auto whitespace-pre-wrap text-xs text-muted">{this.state.error.message}</pre>
        <Button variant="secondary" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    )
  }
}

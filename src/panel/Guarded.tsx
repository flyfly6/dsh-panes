import * as React from 'react'

interface Props {
  fallback: React.ReactNode
  children: React.ReactNode
}

interface State {
  error: Error | null
}

/**
 * Keeps one unsupported host surface from taking the whole panel down: a failing
 * child renders the fallback instead. ponytail: class boundary because React has
 * no hook form; revisit if the host exposes one.
 */
export class Guarded extends React.Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    // Surface it without breaking the app: consoles are the only cheap channel here.
    console.warn('[dsh-workbench] embedded conversation failed:', error)
  }

  override render(): React.ReactNode {
    return this.state.error === null ? this.props.children : this.props.fallback
  }
}

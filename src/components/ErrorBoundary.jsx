import React from 'react'

// Catches render/runtime errors in the subtree and shows the error text instead
// of a blank white screen, so future crashes are visible and debuggable.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ error, info })
    // Surface to the console/dev tools as well.
    console.error('App crashed:', error, info)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ padding: 16, fontFamily: 'monospace', color: '#b00020', whiteSpace: 'pre-wrap', overflow: 'auto', height: '100%' }}>
        <h2 style={{ marginTop: 0 }}>Something went wrong.</h2>
        <div style={{ fontWeight: 'bold' }}>{String(error && error.message || error)}</div>
        {error && error.stack ? <pre style={{ color: '#555' }}>{error.stack}</pre> : null}
        {info && info.componentStack ? <pre style={{ color: '#888' }}>{info.componentStack}</pre> : null}
      </div>
    )
  }
}

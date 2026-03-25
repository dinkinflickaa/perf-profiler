import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

let renderCount = 0;

// Error boundary that tries to "recover" by resetting state,
// which re-renders the broken child, which throws again, repeat...
export class BuggyErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    renderCount++;
    console.log(`[BuggyErrorBoundary] getDerivedStateFromError #${renderCount}:`, error.message);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.log(`[BuggyErrorBoundary] componentDidCatch #${this.state.retryCount + 1}`);
    console.log('  Error:', error.message);

    // Simulate a common bug: "retry" by clearing the error state,
    // which re-mounts the broken child, which throws again → loop
    console.log('[BuggyErrorBoundary] Attempting recovery via setState...');
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
  }

  render() {
    console.log(`[BuggyErrorBoundary] render() called, hasError=${this.state.hasError}, retryCount=${this.state.retryCount}`);

    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: 20 }}>
          <h2>Error caught (attempt #{this.state.retryCount})</h2>
          <p>{this.state.error?.message}</p>
          <p>Retrying automatically via componentDidCatch setState...</p>
        </div>
      );
    }

    return this.props.children;
  }
}

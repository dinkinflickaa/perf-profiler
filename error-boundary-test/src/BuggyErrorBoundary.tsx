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

// Error boundary that retries via async setState — bypasses React's
// "Maximum update depth exceeded" guard and loops forever.
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

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    console.log(`[BuggyErrorBoundary] componentDidCatch #${this.state.retryCount + 1} — scheduling async retry`);

    // BUG: setTimeout makes each retry a new top-level render cycle,
    // so React's nestedUpdateCount resets and never hits the limit.
    setTimeout(() => {
      this.setState((prev) => ({
        hasError: false,
        error: null,
        retryCount: prev.retryCount + 1,
      }));
    }, 0);
  }

  render() {
    console.log(`[BuggyErrorBoundary] render, hasError=${this.state.hasError}, retryCount=${this.state.retryCount}`);

    if (this.state.hasError) {
      return (
        <div style={{ color: 'orange', padding: 20 }}>
          <h2>Error caught (attempt #{this.state.retryCount})</h2>
          <p>{this.state.error?.message}</p>
          <p>Retrying via setTimeout setState... (this will loop forever)</p>
        </div>
      );
    }

    return this.props.children;
  }
}

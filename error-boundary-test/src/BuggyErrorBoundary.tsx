import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Error boundary class component that ALSO throws when rendering fallback UI
export class BuggyErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    console.log('[BuggyErrorBoundary] getDerivedStateFromError called with:', error.message);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.log('[BuggyErrorBoundary] componentDidCatch called');
    console.log('  Error:', error.message);
    console.log('  Component stack:', errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      console.log('[BuggyErrorBoundary] Rendering fallback... but about to throw!');
      // The error boundary itself throws when trying to render the fallback
      throw new Error('BuggyErrorBoundary: I also explode while rendering the fallback UI!');
    }

    return this.props.children;
  }
}

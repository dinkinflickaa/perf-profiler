import React from 'react';
import { BuggyErrorBoundary } from './BuggyErrorBoundary';
import { BrokenComponent } from './BrokenComponent';

export function App() {
  return (
    <div style={{ fontFamily: 'monospace', padding: 20 }}>
      <h1>Error Boundary Infinite Loop REPRO</h1>
      <h3>React 18 — ReactDOM.render (legacy)</h3>
      <p>
        <strong>Bug:</strong> <code>BrokenComponent</code> throws →
        <code>BuggyErrorBoundary</code> catches it →
        <code>componentDidCatch</code> calls{' '}
        <code>setTimeout(() =&gt; setState(...))</code> to retry →
        re-renders children → <code>BrokenComponent</code> throws again → repeat <strong>forever</strong>.
      </p>
      <p>
        <strong>Why it loops:</strong> React's "Maximum update depth" guard only
        counts synchronous nested setState calls within a single commit. <code>setTimeout</code>{' '}
        makes each retry a new top-level update, resetting the counter.
      </p>
      <p style={{ color: 'red', fontWeight: 'bold' }}>
        ⚠ WARNING: This WILL freeze your browser tab. Open DevTools console to watch.
      </p>
      <hr />

      <BuggyErrorBoundary>
        <BrokenComponent />
      </BuggyErrorBoundary>
    </div>
  );
}

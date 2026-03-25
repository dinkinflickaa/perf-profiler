import React from 'react';
import { BuggyErrorBoundary } from './BuggyErrorBoundary';
import { BrokenComponent } from './BrokenComponent';

export function App() {
  return (
    <div style={{ fontFamily: 'monospace', padding: 20 }}>
      <h1>Error Boundary Infinite Loop REPRO</h1>
      <h3>React 18 — createRoot (concurrent mode)</h3>
      <p>
        <strong>Bug:</strong> <code>BrokenComponent</code> throws →{' '}
        <code>BuggyErrorBoundary</code> catches it →{' '}
        <code>componentDidCatch</code> calls{' '}
        <code>setTimeout(() =&gt; setState(...))</code> to retry →
        re-renders children → throws again → repeat <strong>forever</strong>.
      </p>
      <p>
        <strong>Why it loops in concurrent mode:</strong> The nested update guard
        (<code>NESTED_UPDATE_LIMIT = 50</code>) only increments when{' '}
        <code>SyncLane</code> is in <code>remainingLanes</code> after commit.
        In concurrent mode, <code>setTimeout</code> setState gets{' '}
        <code>DefaultEventPriority</code> (non-sync lane) → counter resets to 0
        every cycle → never hits 50.
      </p>
      <p style={{ color: 'red', fontWeight: 'bold' }}>
        WARNING: This WILL make the tab unresponsive. Open DevTools console first.
      </p>
      <hr />

      <BuggyErrorBoundary>
        <BrokenComponent />
      </BuggyErrorBoundary>
    </div>
  );
}

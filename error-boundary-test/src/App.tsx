import React from 'react';
import { BuggyErrorBoundary } from './BuggyErrorBoundary';
import { BrokenComponent } from './BrokenComponent';

export function App() {
  return (
    <div style={{ fontFamily: 'monospace', padding: 20 }}>
      <h1>Error Boundary Infinite Loop Test</h1>
      <h3>React 18 — ReactDOM.render (legacy)</h3>
      <p>
        <strong>Scenario:</strong> <code>BrokenComponent</code> throws →
        <code>BuggyErrorBoundary</code> catches it →
        <code>componentDidCatch</code> calls <code>setState</code> to clear
        the error (attempting "recovery") → re-renders children →
        <code>BrokenComponent</code> throws again → repeat.
      </p>
      <p><strong>Question:</strong> Does this infinite loop? Open the console to watch.</p>
      <hr />

      <BuggyErrorBoundary>
        <BrokenComponent />
      </BuggyErrorBoundary>
    </div>
  );
}

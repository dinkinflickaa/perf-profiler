import React from 'react';
import { BuggyErrorBoundary } from './BuggyErrorBoundary';
import { BrokenComponent } from './BrokenComponent';

export function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', padding: 20 }}>
      <h1>Error Boundary Test (React 18 - ReactDOM.render)</h1>
      <p>
        Scenario: <code>BrokenComponent</code> throws during render →
        caught by <code>BuggyErrorBoundary</code> → which also throws
        in its <code>render()</code> when trying to show the fallback.
      </p>
      <hr />

      <BuggyErrorBoundary>
        <BrokenComponent />
      </BuggyErrorBoundary>
    </div>
  );
}

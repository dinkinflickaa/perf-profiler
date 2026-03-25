import React, { useState } from 'react';
import { BuggyErrorBoundary } from './BuggyErrorBoundary';
import { BrokenComponent } from './BrokenComponent';
import { ApolloParent } from './ApolloParent';

export function App() {
  const [showSlotRepro, setShowSlotRepro] = useState(false);
  const [showOriginalRepro, setShowOriginalRepro] = useState(false);

  return (
    <div style={{ fontFamily: 'monospace', padding: 20 }}>
      <h1>Error Boundary Infinite Loop REPROs</h1>
      <h3>React 18 — createRoot (concurrent mode)</h3>

      <p style={{ color: 'red', fontWeight: 'bold' }}>
        WARNING: Clicking either button WILL make the tab unresponsive. Open DevTools console first.
      </p>

      <hr />

      {/* ---- NEW: SlotErrorBoundary + Apollo repro ---- */}
      <section style={{ marginBottom: 30 }}>
        <h2>Repro: SlotErrorBoundary + Apollo correlationId loop</h2>
        <p>
          <strong>Bug:</strong> Apollo query resolves (microtask) &rarr; parent
          re-renders with new <code>correlationId</code> &rarr;{' '}
          <code>SlotErrorBoundary.render()</code> sees mismatch &rarr; calls{' '}
          <code>reloadCallback()</code> (setState during render!) &rarr; clears
          error &rarr; children re-mount &rarr; <code>BrokenComponent</code>{' '}
          throws &rarr; boundary catches &rarr; Apollo fires again &rarr;{' '}
          <strong>infinite loop</strong>.
        </p>
        <p>
          <strong>Why React's guard doesn't catch it:</strong> Each Apollo
          microtask creates a new async boundary, resetting{' '}
          <code>nestedUpdateCount</code> to 0 every cycle.
        </p>
        {showSlotRepro ? (
          <ApolloParent />
        ) : (
          <button onClick={() => setShowSlotRepro(true)}>
            Trigger SlotErrorBoundary loop
          </button>
        )}
      </section>

      <hr />

      {/* ---- Original repro ---- */}
      <section>
        <h2>Repro: BuggyErrorBoundary (Promise.resolve retry)</h2>
        <p>
          <strong>Bug:</strong> <code>BrokenComponent</code> throws &rarr;{' '}
          <code>BuggyErrorBoundary</code> catches &rarr;{' '}
          <code>componentDidCatch</code> calls{' '}
          <code>Promise.resolve(() =&gt; setState(...))</code> to retry &rarr;
          re-renders children &rarr; throws again &rarr; <strong>forever</strong>.
        </p>
        {showOriginalRepro ? (
          <BuggyErrorBoundary>
            <BrokenComponent />
          </BuggyErrorBoundary>
        ) : (
          <button onClick={() => setShowOriginalRepro(true)}>
            Trigger BuggyErrorBoundary loop
          </button>
        )}
      </section>
    </div>
  );
}

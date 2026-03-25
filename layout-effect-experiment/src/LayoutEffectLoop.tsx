import React, { useState, useLayoutEffect, useRef } from 'react';

/**
 * Experiment: setState inside useLayoutEffect — does React's bailout work?
 *
 * React's bailout mechanism: if you call setState with the SAME value as
 * the current state, React bails out (skips re-render). This works via
 * Object.is() comparison.
 *
 * Scenarios tested:
 *
 * 1. SAME VALUE — setState(currentValue) inside useLayoutEffect
 *    Expected: React does a LAZY BAILOUT — renders twice total (not once).
 *    Render #1 = initial mount. Layout effect fires setState(0).
 *    Render #2 = React can't eagerly compare during commit phase, so it
 *    schedules a sync re-render, enters the component, runs the reducer,
 *    sees Object.is(0, 0) === true, and bails out (no commit, no children).
 *    No render #3. Both legacy and concurrent should behave identically.
 *
 * 2. TOGGLING VALUE — setState(prev => !prev) inside useLayoutEffect
 *    Expected: Infinite loop. useLayoutEffect runs synchronously before
 *    paint, and each setState produces a new value, so no bailout.
 *    React's nestedUpdateCount SHOULD catch this (limit = 50).
 *    Question: Does legacy vs concurrent differ in how fast it catches it?
 *
 * 3. INCREMENTING COUNTER — setState(prev => prev + 1) inside useLayoutEffect
 *    Expected: Same as toggling — infinite loop caught at 50 iterations.
 *
 * 4. CONDITIONAL — setState only when counter < 5 inside useLayoutEffect
 *    Expected: Renders 6 times then stabilizes. No infinite loop.
 *    Tests that the bailout kicks in once the condition stops firing.
 */

interface Props {
  label: string;
  mode: 'legacy' | 'concurrent';
}

// ─── Scenario 1: Same value (should bailout) ───────────────────────────
export function SameValueExperiment({ label, mode }: Props) {
  const renderCount = useRef(0);
  const [value, setValue] = useState(0);
  renderCount.current++;

  useLayoutEffect(() => {
    console.log(`[${label}][SameValue] useLayoutEffect — setValue(0), render #${renderCount.current}`);
    // Same value → lazy bailout. React can't eagerly compare during commit
    // phase, so it schedules a re-render, enters component, runs reducer,
    // sees Object.is(0,0)===true, then bails (no commit, no children).
    setValue(0);
  });

  console.log(`[${label}][SameValue] render #${renderCount.current}, value=${value}`);

  return (
    <div>
      <strong>Scenario 1 — Same Value:</strong> renders={renderCount.current}, value={value}
    </div>
  );
}

// ─── Scenario 2: Toggling value (should hit nested update limit) ───────
export function TogglingExperiment({ label, mode }: Props) {
  const renderCount = useRef(0);
  const [flag, setFlag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  renderCount.current++;

  useLayoutEffect(() => {
    if (renderCount.current > 55) {
      // Safety valve — shouldn't reach here if React catches it at 50
      return;
    }
    console.log(`[${label}][Toggle] useLayoutEffect — setFlag(!flag), render #${renderCount.current}`);
    setFlag(prev => !prev);
  });

  console.log(`[${label}][Toggle] render #${renderCount.current}, flag=${flag}`);

  return (
    <div>
      <strong>Scenario 2 — Toggle:</strong> renders={renderCount.current}, flag={String(flag)}
      {renderCount.current >= 50 && (
        <span style={{ color: 'red' }}> (hit limit!)</span>
      )}
    </div>
  );
}

// ─── Scenario 3: Incrementing counter (should hit nested update limit) ─
export function IncrementingExperiment({ label, mode }: Props) {
  const renderCount = useRef(0);
  const [count, setCount] = useState(0);
  renderCount.current++;

  useLayoutEffect(() => {
    if (renderCount.current > 55) return; // safety
    console.log(`[${label}][Increment] useLayoutEffect — setCount(${count}+1), render #${renderCount.current}`);
    setCount(prev => prev + 1);
  });

  console.log(`[${label}][Increment] render #${renderCount.current}, count=${count}`);

  return (
    <div>
      <strong>Scenario 3 — Increment:</strong> renders={renderCount.current}, count={count}
      {renderCount.current >= 50 && (
        <span style={{ color: 'red' }}> (hit limit!)</span>
      )}
    </div>
  );
}

// ─── Scenario 4: Conditional (should stabilize at 5) ──────────────────
export function ConditionalExperiment({ label, mode }: Props) {
  const renderCount = useRef(0);
  const [count, setCount] = useState(0);
  renderCount.current++;

  useLayoutEffect(() => {
    console.log(`[${label}][Conditional] useLayoutEffect — count=${count}, render #${renderCount.current}`);
    if (count < 5) {
      setCount(prev => prev + 1);
    }
    // Once count >= 5, no setState → no more re-renders → loop stops
  });

  console.log(`[${label}][Conditional] render #${renderCount.current}, count=${count}`);

  return (
    <div>
      <strong>Scenario 4 — Conditional (stop at 5):</strong> renders={renderCount.current}, count={count}
      {count >= 5 && <span style={{ color: 'green' }}> (stabilized!)</span>}
    </div>
  );
}

// ─── Scenario 5: useLayoutEffect + async followup (the real danger) ────
// This mimics the error boundary pattern: layout effect triggers sync setState,
// but an async microtask ALSO triggers setState with new data.
export function LayoutEffectWithAsyncExperiment({ label, mode }: Props) {
  const renderCount = useRef(0);
  const [syncCount, setSyncCount] = useState(0);
  const [asyncData, setAsyncData] = useState('initial');
  renderCount.current++;

  useLayoutEffect(() => {
    if (renderCount.current > 55) return; // safety
    console.log(`[${label}][LayoutAsync] useLayoutEffect — sync setState + async microtask, render #${renderCount.current}`);

    // Sync setState inside layoutEffect — React processes this before paint
    setSyncCount(prev => prev + 1);

    // Async setState via microtask — this creates a NEW update cycle
    // In concurrent mode, does this break the nestedUpdateCount tracking?
    Promise.resolve().then(() => {
      console.log(`[${label}][LayoutAsync] microtask — setAsyncData, render was #${renderCount.current}`);
      setAsyncData(`data-${renderCount.current}`);
    });
  });

  console.log(`[${label}][LayoutAsync] render #${renderCount.current}, syncCount=${syncCount}, asyncData=${asyncData}`);

  return (
    <div>
      <strong>Scenario 5 — Layout + Async:</strong> renders={renderCount.current},
      syncCount={syncCount}, asyncData={asyncData}
      {renderCount.current >= 50 && (
        <span style={{ color: 'red' }}> (hit limit!)</span>
      )}
    </div>
  );
}

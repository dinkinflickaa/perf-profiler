import React, { useState } from 'react';
import {
  SameValueExperiment,
  TogglingExperiment,
  IncrementingExperiment,
  ConditionalExperiment,
  LayoutEffectWithAsyncExperiment,
} from './LayoutEffectLoop';

interface PanelProps {
  mode: 'legacy' | 'concurrent';
}

type Scenario = 'same' | 'toggle' | 'increment' | 'conditional' | 'layout-async';

const scenarios: { key: Scenario; label: string; danger: boolean }[] = [
  { key: 'same', label: '1. Same Value (bailout expected)', danger: false },
  { key: 'toggle', label: '2. Toggle (infinite → caught at 50)', danger: true },
  { key: 'increment', label: '3. Increment (infinite → caught at 50)', danger: true },
  { key: 'conditional', label: '4. Conditional (stabilizes at 5)', danger: false },
  { key: 'layout-async', label: '5. Layout + Async Microtask (the real danger)', danger: true },
];

function ExperimentPanel({ mode }: PanelProps) {
  const [active, setActive] = useState<Scenario | null>(null);
  const label = mode === 'legacy' ? 'LEGACY' : 'CONCURRENT';

  return (
    <div style={{
      border: '2px solid',
      borderColor: mode === 'legacy' ? '#666' : '#0af',
      padding: 16,
      borderRadius: 8,
      flex: 1,
      minWidth: 400,
    }}>
      <h2 style={{ margin: '0 0 8px' }}>
        {mode === 'legacy' ? 'ReactDOM.render (Legacy)' : 'createRoot (Concurrent)'}
      </h2>
      <p style={{ fontSize: 12, color: '#888' }}>
        {mode === 'legacy'
          ? 'Sync rendering. All updates in layoutEffect are part of the same sync batch.'
          : 'Concurrent rendering. Updates may get different lanes/priorities.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {scenarios.map(s => (
          <button
            key={s.key}
            onClick={() => setActive(active === s.key ? null : s.key)}
            style={{
              textAlign: 'left',
              padding: '6px 10px',
              background: active === s.key ? (s.danger ? '#fdd' : '#dfd') : '#f5f5f5',
              border: '1px solid #ccc',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 13,
            }}
          >
            {active === s.key ? '■ Stop' : '▶'} {s.label}
            {s.danger && ' ⚠'}
          </button>
        ))}
      </div>

      <div style={{ background: '#fafafa', padding: 12, borderRadius: 4, minHeight: 40 }}>
        {active === 'same' && <SameValueExperiment label={label} mode={mode} />}
        {active === 'toggle' && <TogglingExperiment label={label} mode={mode} />}
        {active === 'increment' && <IncrementingExperiment label={label} mode={mode} />}
        {active === 'conditional' && <ConditionalExperiment label={label} mode={mode} />}
        {active === 'layout-async' && <LayoutEffectWithAsyncExperiment label={label} mode={mode} />}
        {active === null && <span style={{ color: '#999' }}>Click a scenario above</span>}
      </div>
    </div>
  );
}

export function LegacyApp() {
  return <ExperimentPanel mode="legacy" />;
}

export function ConcurrentApp() {
  return <ExperimentPanel mode="concurrent" />;
}

export function AppShell() {
  return (
    <div style={{ fontFamily: 'monospace', padding: 20 }}>
      <h1>useLayoutEffect + setState — Bailout Experiment</h1>
      <h3>React 18: Legacy (ReactDOM.render) vs Concurrent (createRoot)</h3>

      <div style={{
        background: '#fff3cd', border: '1px solid #ffc107',
        padding: 12, borderRadius: 6, marginBottom: 16,
      }}>
        <strong>What this tests:</strong>
        <ul style={{ margin: '6px 0', paddingLeft: 20, fontSize: 13 }}>
          <li><strong>Bailout:</strong> setState(sameValue) in useLayoutEffect triggers a lazy bailout (2 renders, not 1) — React must re-enter the component to discover nothing changed.</li>
          <li><strong>Nested update limit:</strong> Does React catch infinite loops (limit=50) for sync setState in useLayoutEffect?</li>
          <li><strong>Legacy vs Concurrent:</strong> Do they differ in how nestedUpdateCount tracks layout-effect setState?</li>
          <li><strong>Async escape:</strong> Can a Promise.resolve() microtask inside useLayoutEffect bypass the guard?</li>
        </ul>
      </div>

      <p style={{ color: 'red', fontWeight: 'bold', fontSize: 13 }}>
        ⚠ Scenarios 2, 3, 5 may throw "Maximum update depth exceeded" — that's expected!
        Scenario 5 may freeze the tab if the async microtask bypasses the guard.
      </p>

      <p style={{ fontSize: 13, color: '#555' }}>
        <strong>Key difference:</strong> In legacy mode, useLayoutEffect setState is always
        processed synchronously within the same commit. In concurrent mode, React may assign
        different update lanes, potentially changing how nestedUpdateCount is tracked.
      </p>
    </div>
  );
}

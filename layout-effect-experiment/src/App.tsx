import React, { useState } from 'react';
import {
  SameValueExperiment,
  TogglingExperiment,
  IncrementingExperiment,
  ConditionalExperiment,
  LayoutEffectWithAsyncExperiment,
} from './LayoutEffectLoop';
import {
  EagerBailoutOnMount,
  EagerBailoutOnRerender,
  EagerBailoutUpdaterFn,
  LayoutVsEffectComparison,
  NoBailoutControl,
} from './EagerBailoutTests';

interface PanelProps {
  mode: 'legacy' | 'concurrent';
}

type Tab = 'eager-bailout' | 'loop-scenarios';

// ─── Eager Bailout Panel ─────────────────────────────────────────────────
function EagerBailoutPanel({ mode }: PanelProps) {
  const label = mode === 'legacy' ? 'LEGACY' : 'CONCURRENT';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <EagerBailoutOnMount label={label} mode={mode} />
      <EagerBailoutUpdaterFn label={label} mode={mode} />
      <LayoutVsEffectComparison label={label} mode={mode} />
      <NoBailoutControl label={label} mode={mode} />
      <EagerBailoutOnRerender label={label} mode={mode} />
    </div>
  );
}

// ─── Loop Scenarios Panel ────────────────────────────────────────────────
type LoopScenario = 'same' | 'toggle' | 'increment' | 'conditional' | 'layout-async';

const loopScenarios: { key: LoopScenario; label: string; danger: boolean }[] = [
  { key: 'same', label: '1. Same Value (bailout expected)', danger: false },
  { key: 'toggle', label: '2. Toggle (infinite → caught at 50)', danger: true },
  { key: 'increment', label: '3. Increment (infinite → caught at 50)', danger: true },
  { key: 'conditional', label: '4. Conditional (stabilizes at 5)', danger: false },
  { key: 'layout-async', label: '5. Layout + Async Microtask (the real danger)', danger: true },
];

function LoopScenariosPanel({ mode }: PanelProps) {
  const [active, setActive] = useState<LoopScenario | null>(null);
  const label = mode === 'legacy' ? 'LEGACY' : 'CONCURRENT';

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {loopScenarios.map(s => (
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

// ─── Main Panel per mode ─────────────────────────────────────────────────
function ExperimentPanel({ mode }: PanelProps) {
  const [tab, setTab] = useState<Tab>('eager-bailout');

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

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setTab('eager-bailout')}
          style={{
            padding: '6px 12px',
            background: tab === 'eager-bailout' ? '#e0e7ff' : '#f5f5f5',
            border: tab === 'eager-bailout' ? '2px solid #4f46e5' : '1px solid #ccc',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: tab === 'eager-bailout' ? 'bold' : 'normal',
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        >
          dispatchSetState Eager Bailout
        </button>
        <button
          onClick={() => setTab('loop-scenarios')}
          style={{
            padding: '6px 12px',
            background: tab === 'loop-scenarios' ? '#e0e7ff' : '#f5f5f5',
            border: tab === 'loop-scenarios' ? '2px solid #4f46e5' : '1px solid #ccc',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: tab === 'loop-scenarios' ? 'bold' : 'normal',
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        >
          Loop Scenarios
        </button>
      </div>

      {tab === 'eager-bailout' ? (
        <EagerBailoutPanel mode={mode} />
      ) : (
        <LoopScenariosPanel mode={mode} />
      )}
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
        <strong>dispatchSetState eager bailout — the key check:</strong>
        <pre style={{ margin: '8px 0', padding: 8, background: '#f8f8f8', fontSize: 12, overflow: 'auto' }}>
{`// ReactFiberHooks.js — dispatchSetState
if (fiber.lanes === NoLanes &&
    (alternate === null || alternate.lanes === NoLanes)) {
  // EAGER: compute state NOW, compare with Object.is
  const eagerState = lastRenderedReducer(currentState, action);
  if (is(eagerState, currentState)) {
    enqueueConcurrentHookUpdateAndEagerlyBailout(...);
    return; // ← NO scheduleUpdateOnFiber, NO re-render
  }
}
// FALLBACK: schedule a full re-render (lazy bailout)`}
        </pre>
        <ul style={{ margin: '6px 0', paddingLeft: 20, fontSize: 13 }}>
          <li>
            <strong>Eager bailout (1 render):</strong> dispatchSetState computes the new state
            inline, sees it's the same via Object.is, and returns without scheduling any work.
            Component function is never called again.
          </li>
          <li>
            <strong>Lazy bailout (2 renders):</strong> The lanes check fails, so React enqueues
            the update and calls scheduleUpdateOnFiber. React re-enters the component, runs the
            reducer, discovers the state is the same, and bails out (no commit). But the
            component function DID execute once more.
          </li>
          <li>
            <strong>Key question:</strong> During useLayoutEffect, is{' '}
            <code>fiber.lanes === NoLanes && alternate.lanes === NoLanes</code>?
            If <code>alternate.lanes</code> still has the triggering lane bits,
            the eager path is skipped even though the value is the same.
          </li>
          <li>
            <strong>Legacy vs Concurrent:</strong> Does <code>createRoot</code> handle
            fiber lane clearing differently from <code>ReactDOM.render</code> during commit?
          </li>
        </ul>
      </div>
    </div>
  );
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppShell, LegacyApp, ConcurrentApp } from './App';

// ─── Shared header ──────────────────────────────────────────────────────
const headerRoot = document.createElement('div');
document.body.prepend(headerRoot);
ReactDOM.createRoot(headerRoot).render(<AppShell />);

// ─── Side-by-side container ─────────────────────────────────────────────
const container = document.createElement('div');
container.style.display = 'flex';
container.style.gap = '20px';
container.style.padding = '0 20px 20px';
container.style.flexWrap = 'wrap';
document.body.appendChild(container);

const legacyDiv = document.createElement('div');
legacyDiv.style.flex = '1';
legacyDiv.style.minWidth = '400px';
container.appendChild(legacyDiv);

const concurrentDiv = document.createElement('div');
concurrentDiv.style.flex = '1';
concurrentDiv.style.minWidth = '400px';
container.appendChild(concurrentDiv);

// ─── LEGACY MODE: ReactDOM.render ───────────────────────────────────────
// React 18 still supports the legacy API. Updates here use the legacy
// sync rendering pipeline (SyncLane only). nestedUpdateCount is tracked
// per-root and incremented on every flushSyncCallbacks re-entry.
// @ts-ignore — legacy API, React 18 still exports it
ReactDOM.render(<LegacyApp />, legacyDiv);

// ─── CONCURRENT MODE: createRoot ────────────────────────────────────────
// Uses the concurrent pipeline. setState in useLayoutEffect gets
// SyncLane (same as legacy for layout effects), BUT the commit phase
// handling and nestedUpdateCount tracking may differ for async followups.
ReactDOM.createRoot(concurrentDiv).render(<ConcurrentApp />);

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Layout Effect Bailout Experiment — React ${React.version}            ║
║                                                              ║
║  LEFT panel  = ReactDOM.render (legacy sync mode)            ║
║  RIGHT panel = createRoot (concurrent mode)                  ║
║                                                              ║
║  Watch the console for [LEGACY] vs [CONCURRENT] logs.        ║
║  Compare render counts and whether the 50-limit catches it.  ║
╚══════════════════════════════════════════════════════════════╝
`);

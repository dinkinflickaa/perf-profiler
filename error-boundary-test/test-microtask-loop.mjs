// Test: Promise.resolve().then(() => setState) in componentDidCatch
// Microtasks are worse than setTimeout — they drain before the browser can paint,
// so the tab freezes harder and faster.

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><div id="r1"></div><div id="r2"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.MessageChannel = dom.window.MessageChannel || class {
  constructor() {
    this.port1 = { onmessage: null };
    this.port2 = { postMessage: (msg) => {
      if (this.port1.onmessage) setTimeout(() => this.port1.onmessage({ data: msg }), 0);
    }};
  }
};

const React = (await import('react')).default;
const ReactDOM = (await import('react-dom')).default;
const { createRoot } = await import('react-dom/client');

function makeComponents() {
  let throwCount = 0;
  let didCatchCount = 0;
  let stopped = false;

  function BrokenChild() {
    throwCount++;
    throw new Error(`boom #${throwCount}`);
  }

  class EB extends React.Component {
    constructor(p) { super(p); this.state = { hasError: false }; }
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch() {
      didCatchCount++;
      if (stopped) return;
      Promise.resolve().then(() => {
        if (!stopped) this.setState({ hasError: false });
      });
    }
    render() {
      if (this.state.hasError) return React.createElement('div', null, 'fallback');
      return this.props.children;
    }
  }

  function App() {
    return React.createElement(EB, null, React.createElement(BrokenChild));
  }

  return { App, getThrows: () => throwCount, getCatches: () => didCatchCount, stop: () => { stopped = true; } };
}

// --- Legacy mode ---
console.log('=== Legacy + Promise.resolve() setState ===');
const c1 = makeComponents();
try {
  ReactDOM.render(React.createElement(c1.App), document.getElementById('r1'));
} catch (e) {
  console.log(`  Sync error: ${e.message.slice(0, 70)}`);
}

const checkpoints = [1, 3, 5];
for (const s of checkpoints) {
  setTimeout(() => {
    console.log(`  [${s}s] throws=${c1.getThrows()} catches=${c1.getCatches()}`);
  }, s * 1000);
}

setTimeout(() => {
  c1.stop();
  const t = c1.getThrows();
  console.log(`  FINAL (5s): throws=${t} → ${t <= 200 ? 'STOPPED' : 'INFINITE LOOP'}`);

  // --- Concurrent mode ---
  console.log('\n=== Concurrent + Promise.resolve() setState ===');
  const c2 = makeComponents();
  const root = createRoot(document.getElementById('r2'));
  root.render(React.createElement(c2.App));

  for (const s of checkpoints) {
    setTimeout(() => {
      console.log(`  [${s}s] throws=${c2.getThrows()} catches=${c2.getCatches()}`);
    }, s * 1000);
  }

  setTimeout(() => {
    c2.stop();
    root.unmount();
    const t2 = c2.getThrows();
    console.log(`  FINAL (5s): throws=${t2} → ${t2 <= 200 ? 'STOPPED' : 'INFINITE LOOP'}`);

    console.log('\n=== SUMMARY ===');
    console.log(`Legacy     + Promise.resolve(): ${t} throws/5s → ${t <= 200 ? 'STOPPED' : 'INFINITE'}`);
    console.log(`Concurrent + Promise.resolve(): ${t2} throws/5s → ${t2 <= 200 ? 'STOPPED' : 'INFINITE'}`);
    process.exit(0);
  }, 6000);
}, 6000);

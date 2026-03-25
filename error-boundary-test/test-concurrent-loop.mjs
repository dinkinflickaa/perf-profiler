// Test: createRoot (concurrent mode) + setTimeout setState in componentDidCatch
// Expected: infinite loop — nestedUpdateCount never triggers because lane is not SyncLane

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
// React 18 concurrent mode needs MessageChannel for scheduler
globalThis.MessageChannel = dom.window.MessageChannel || class {
  constructor() {
    this.port1 = { onmessage: null };
    this.port2 = { postMessage: (msg) => {
      if (this.port1.onmessage) setTimeout(() => this.port1.onmessage({ data: msg }), 0);
    }};
  }
};

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const ReactDOM = (await import('react-dom')).default;

// --- Counters ---
let throwCount = 0;
let didCatchCount = 0;
let renderCount = 0;

// --- BrokenComponent ---
function BrokenComponent() {
  throwCount++;
  throw new Error(`explosion #${throwCount}`);
}

// --- BuggyErrorBoundary ---
class BuggyErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, _errorInfo) {
    didCatchCount++;
    // Async retry — the key to the bypass
    setTimeout(() => {
      this.setState({ hasError: false, error: null });
    }, 0);
  }

  render() {
    renderCount++;
    if (this.state.hasError) {
      return React.createElement('div', null, 'fallback');
    }
    return this.props.children;
  }
}

function App() {
  return React.createElement(BuggyErrorBoundary, null, React.createElement(BrokenComponent));
}

function snapshot(label) {
  console.log(`[${label}] throws=${throwCount} catches=${didCatchCount} renders=${renderCount}`);
}

// ============================
// TEST 1: createRoot (concurrent mode)
// ============================
console.log('=== TEST: createRoot (concurrent mode) + setTimeout setState ===\n');

throwCount = 0; didCatchCount = 0; renderCount = 0;

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));

const checkpoints = [1000, 3000, 5000];
for (const ms of checkpoints) {
  setTimeout(() => snapshot(`${ms / 1000}s`), ms);
}

setTimeout(() => {
  snapshot('7s FINAL');
  console.log('\n--- VERDICT ---');
  if (throwCount > 200) {
    console.log(`INFINITE LOOP CONFIRMED: ${throwCount} throws in 7s, still running.`);
    console.log('React concurrent mode does NOT stop this loop.');
  } else if (throwCount > 50) {
    console.log(`Loop ran ${throwCount} times — guard was bypassed but loop was slow.`);
  } else {
    console.log(`Loop stopped at ${throwCount} — React guard caught it.`);
  }

  root.unmount();
  process.exit(0);
}, 7000);

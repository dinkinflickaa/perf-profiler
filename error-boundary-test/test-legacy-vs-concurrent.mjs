// Side-by-side: legacy ReactDOM.render vs createRoot with setTimeout setState
// Legacy should eventually stop. Concurrent should loop forever.

import { JSDOM } from 'jsdom';

function setupDOM() {
  const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
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
  return dom;
}

setupDOM();

const React = (await import('react')).default;
const ReactDOM = (await import('react-dom')).default;
const { createRoot } = await import('react-dom/client');

let throwCount = 0;
let didCatchCount = 0;
let stopped = false;

function BrokenComponent() {
  throwCount++;
  throw new Error(`explosion #${throwCount}`);
}

class BuggyErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    didCatchCount++;
    setTimeout(() => {
      if (!stopped) this.setState({ hasError: false });
    }, 0);
  }
  render() {
    if (this.state.hasError) return React.createElement('div', null, 'fallback');
    return this.props.children;
  }
}

function App() {
  return React.createElement(BuggyErrorBoundary, null, React.createElement(BrokenComponent));
}

// --- TEST 1: Legacy ---
console.log('=== LEGACY MODE (ReactDOM.render) ===');
throwCount = 0; didCatchCount = 0; stopped = false;

try {
  ReactDOM.render(React.createElement(App), document.getElementById('root'));
} catch (e) {
  console.log(`  Sync error: ${e.message.slice(0, 80)}`);
}

await new Promise(r => setTimeout(r, 5000));
stopped = true;
const legacyThrows = throwCount;
const legacyCatches = didCatchCount;
console.log(`  After 5s: throws=${legacyThrows}, catches=${legacyCatches}`);
if (legacyThrows <= 200) {
  console.log('  RESULT: Guard STOPPED the loop.\n');
} else {
  console.log('  RESULT: Guard BYPASSED — loop kept going.\n');
}

// --- TEST 2: Concurrent ---
// Need a fresh DOM element
const el = document.createElement('div');
el.id = 'root2';
document.body.appendChild(el);

console.log('=== CONCURRENT MODE (createRoot) ===');
throwCount = 0; didCatchCount = 0; stopped = false;

const root = createRoot(el);
root.render(React.createElement(App));

await new Promise(r => setTimeout(r, 5000));
stopped = true;
root.unmount();
const concurrentThrows = throwCount;
const concurrentCatches = didCatchCount;
console.log(`  After 5s: throws=${concurrentThrows}, catches=${concurrentCatches}`);
if (concurrentThrows <= 200) {
  console.log('  RESULT: Guard STOPPED the loop.\n');
} else {
  console.log('  RESULT: Guard BYPASSED — loop kept going.\n');
}

// --- Summary ---
console.log('=== SUMMARY ===');
console.log(`Legacy:     ${legacyThrows} throws in 5s → ${legacyThrows <= 200 ? 'STOPPED' : 'INFINITE'}`);
console.log(`Concurrent: ${concurrentThrows} throws in 5s → ${concurrentThrows <= 200 ? 'STOPPED' : 'INFINITE'}`);

process.exit(0);

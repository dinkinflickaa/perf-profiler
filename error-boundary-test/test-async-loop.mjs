// Node.js test: does scheduling setState asynchronously in componentDidCatch
// bypass React's "Maximum update depth exceeded" guard and cause an infinite loop?
// Uses react-dom + jsdom to simulate browser rendering.

import { JSDOM } from 'jsdom';
import React from 'react';
import ReactDOM from 'react-dom';

// Set up a minimal DOM
const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

// --- Counters ---
let throwCount = 0;
let getDerivedCount = 0;
let didCatchCount = 0;
let renderCount = 0;
const MAX_LOG = 60; // safety: stop verbose logging early

function log(msg) {
  const total = throwCount + getDerivedCount + didCatchCount + renderCount;
  if (total < MAX_LOG) console.log(msg);
}

// --- BrokenComponent ---
function BrokenComponent() {
  throwCount++;
  log(`[BrokenComponent] throw #${throwCount}`);
  throw new Error(`explosion #${throwCount}`);
}

// --- BuggyErrorBoundary (async retry via setTimeout) ---
class BuggyErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error) {
    getDerivedCount++;
    log(`[ErrorBoundary] getDerivedStateFromError #${getDerivedCount}: ${error.message}`);
    return { hasError: true, error };
  }

  componentDidCatch(error, _errorInfo) {
    didCatchCount++;
    log(`[ErrorBoundary] componentDidCatch #${didCatchCount} — scheduling async setState via setTimeout`);
    // KEY DIFFERENCE: retry is scheduled asynchronously
    setTimeout(() => {
      log(`[ErrorBoundary] setTimeout fired — calling setState to clear error (retry #${this.state.retryCount + 1})`);
      this.setState((prev) => ({
        hasError: false,
        error: null,
        retryCount: prev.retryCount + 1,
      }));
    }, 0);
  }

  render() {
    renderCount++;
    log(`[ErrorBoundary] render #${renderCount}, hasError=${this.state.hasError}, retryCount=${this.state.retryCount}`);
    if (this.state.hasError) {
      return React.createElement('div', null, `Fallback — attempt #${this.state.retryCount}`);
    }
    return this.props.children;
  }
}

// --- App ---
function App() {
  return React.createElement(
    BuggyErrorBoundary,
    null,
    React.createElement(BrokenComponent)
  );
}

// --- Render with ReactDOM.render (legacy) ---
console.log('=== Starting ReactDOM.render (legacy API) ===');
console.log('=== Testing: async setState via setTimeout in componentDidCatch ===\n');

const root = document.getElementById('root');

function printSummary(label) {
  console.log(`\n--- ${label} ---`);
  console.log(`BrokenComponent throw count : ${throwCount}`);
  console.log(`getDerivedStateFromError count: ${getDerivedCount}`);
  console.log(`componentDidCatch count      : ${didCatchCount}`);
  console.log(`ErrorBoundary render count   : ${renderCount}`);
  console.log(`Final DOM content: "${root.innerHTML}"`);
}

// Interval checkpoints at 1s, 3s, 5s, 8s
const checkpoints = [1, 3, 5, 8];
const checkpointTimers = checkpoints.map((sec) =>
  setTimeout(() => {
    printSummary(`CHECKPOINT at ${sec}s`);
    if (throwCount > 50) {
      console.log(`>> Loop is clearly ongoing at ${sec}s — counts are still growing.`);
    }
  }, sec * 1000)
);

// Hard timeout at 10 seconds
const hardTimeout = setTimeout(() => {
  checkpointTimers.forEach(clearTimeout);
  printSummary('HARD TIMEOUT at 10s');
  if (throwCount > 50) {
    console.log('\n!!! RESULT: INFINITE LOOP DETECTED — async scheduling in componentDidCatch');
    console.log('    bypasses React\'s "Maximum update depth exceeded" guard. !!!');
  } else {
    console.log('\nRESULT: React stopped the loop after a finite number of retries.');
  }
  process.exit(1);
}, 10000);

try {
  ReactDOM.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
    root
  );
} catch (e) {
  console.log(`\n[TOP LEVEL] Uncaught error: ${e.message}`);
}

// If everything settles before the hard timeout, report and exit
setTimeout(() => {
  clearTimeout(hardTimeout);
  checkpointTimers.forEach(clearTimeout);
  console.log('\n=== Settled after 12 seconds (no timeout hit) ===');
  printSummary('FINAL SUMMARY');
  if (throwCount > 50) {
    console.log('\n!!! RESULT: INFINITE LOOP DETECTED — async scheduling in componentDidCatch');
    console.log('    bypasses React\'s "Maximum update depth exceeded" guard. !!!');
  } else {
    console.log('\nRESULT: React stopped the loop after a finite number of retries.');
  }
  process.exit(0);
}, 12000);

// Node.js test: does the error boundary retry loop infinitely?
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
const MAX_LOG = 200; // safety: stop logging after this many

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

// --- BuggyErrorBoundary ---
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
    log(`[ErrorBoundary] componentDidCatch #${didCatchCount} — calling setState to retry`);
    // This is the "buggy recovery" — clears error, re-renders broken child
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
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
console.log('=== Starting ReactDOM.render (legacy API) ===\n');

const root = document.getElementById('root');

// Set a hard timeout so we don't hang forever
const timeout = setTimeout(() => {
  console.log('\n!!! TIMEOUT after 5 seconds — likely infinite loop !!!');
  printSummary();
  process.exit(1);
}, 5000);

try {
  ReactDOM.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
    root
  );
} catch (e) {
  console.log(`\n[TOP LEVEL] Uncaught error: ${e.message}`);
}

// Give async setState calls a chance to run
setTimeout(() => {
  clearTimeout(timeout);
  console.log('\n=== Settled after 2 seconds ===');
  printSummary();
}, 2000);

function printSummary() {
  console.log('\n--- SUMMARY ---');
  console.log(`BrokenComponent throw count : ${throwCount}`);
  console.log(`getDerivedStateFromError count: ${getDerivedCount}`);
  console.log(`componentDidCatch count      : ${didCatchCount}`);
  console.log(`ErrorBoundary render count   : ${renderCount}`);
  console.log(`Final DOM content: "${root.innerHTML}"`);

  if (throwCount > 50) {
    console.log('\n⚠️  RESULT: Looks like an infinite (or very long) loop!');
  } else {
    console.log('\n✅ RESULT: React stopped the loop after a finite number of retries.');
  }
}

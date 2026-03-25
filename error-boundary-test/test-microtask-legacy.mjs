// Test: Legacy mode + Promise.resolve() setState in componentDidCatch
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const React = (await import('react')).default;
const ReactDOM = (await import('react-dom')).default;

let throwCount = 0;
let didCatchCount = 0;
let stopped = false;

function BrokenChild() {
  throwCount++;
  throw new Error(`boom`);
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

// Force kill after 5s — microtasks may starve setTimeout, so use SIGALRM-style
const startTime = Date.now();
const interval = setInterval(() => {
  const elapsed = Date.now() - startTime;
  if (elapsed >= 1000 && !stopped) {
    console.log(`[${(elapsed / 1000).toFixed(1)}s] throws=${throwCount} catches=${didCatchCount}`);
  }
  if (elapsed >= 5000) {
    stopped = true;
    clearInterval(interval);
    console.log(`\nFINAL: ${throwCount} throws in 5s → ${throwCount <= 200 ? 'STOPPED' : 'INFINITE LOOP'}`);
    process.exit(0);
  }
}, 500);

try {
  ReactDOM.render(React.createElement(App), document.getElementById('root'));
} catch (e) {
  console.log(`Sync error after ${throwCount} throws: ${e.message.slice(0, 70)}`);
}

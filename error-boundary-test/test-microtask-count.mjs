// Test: count iterations of Promise.resolve() loop before force kill via signal
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const React = (await import('react')).default;
const ReactDOM = (await import('react-dom')).default;

let throwCount = 0;
let didCatchCount = 0;

// Use SIGTERM to print counts before dying
process.on('SIGTERM', () => {
  console.log(`\nKILLED — throws=${throwCount} catches=${didCatchCount}`);
  console.log(throwCount > 200 ? 'INFINITE LOOP (microtask starvation)' : 'STOPPED');
  process.exit(0);
});

function BrokenChild() {
  throwCount++;
  throw new Error('boom');
}

class EB extends React.Component {
  constructor(p) { super(p); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() {
    didCatchCount++;
    Promise.resolve().then(() => {
      this.setState({ hasError: false });
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

console.log('Starting legacy + Promise.resolve() test...');
console.log('(will be killed via SIGTERM after 5s)');
console.log(`PID: ${process.pid}`);

try {
  ReactDOM.render(React.createElement(App), document.getElementById('root'));
} catch (e) {
  console.log(`Sync error after ${throwCount} throws: ${e.message.slice(0, 70)}`);
}

// Write throw count to file every N iterations so we can read it after force-kill
import { JSDOM } from 'jsdom';
import { writeFileSync } from 'fs';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const React = (await import('react')).default;
const ReactDOM = (await import('react-dom')).default;

let throwCount = 0;
let didCatchCount = 0;
const REPORT_FILE = '/tmp/microtask-loop-count.txt';

function BrokenChild() {
  throwCount++;
  // Write to file every 1000 throws
  if (throwCount % 1000 === 0) {
    writeFileSync(REPORT_FILE, `throws=${throwCount} catches=${didCatchCount}\n`);
  }
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

writeFileSync(REPORT_FILE, 'throws=0 catches=0\n');
console.log('Starting... counts written to ' + REPORT_FILE);

try {
  ReactDOM.render(React.createElement(App), document.getElementById('root'));
} catch (e) {
  writeFileSync(REPORT_FILE, `SYNC_ERROR throws=${throwCount} catches=${didCatchCount} msg=${e.message.slice(0, 80)}\n`);
  console.log('Sync error — check ' + REPORT_FILE);
}

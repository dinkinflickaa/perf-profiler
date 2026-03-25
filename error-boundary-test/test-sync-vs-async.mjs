// Definitive test: sync setState vs setTimeout setState in both modes
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><div id="r1"></div><div id="r2"></div><div id="r3"></div><div id="r4"></div>');
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

function makeComponents(useAsync) {
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
      if (useAsync) {
        setTimeout(() => { if (!stopped) this.setState({ hasError: false }); }, 0);
      } else {
        this.setState({ hasError: false });
      }
    }
    render() {
      if (this.state.hasError) return React.createElement('div', null, 'fallback');
      return this.props.children;
    }
  }

  function App() {
    return React.createElement(EB, null, React.createElement(BrokenChild));
  }

  return {
    App,
    getThrows: () => throwCount,
    getCatches: () => didCatchCount,
    stop: () => { stopped = true; },
  };
}

async function runTest(label, renderFn, useAsync) {
  const c = makeComponents(useAsync);
  let syncError = null;

  try {
    renderFn(c.App);
  } catch (e) {
    syncError = e.message.slice(0, 60);
  }

  if (syncError) {
    console.log(`${label}: SYNC ERROR after ${c.getThrows()} throws: "${syncError}"`);
    c.stop();
    return;
  }

  await new Promise(r => setTimeout(r, 3000));
  c.stop();
  const t = c.getThrows();
  console.log(`${label}: ${t} throws in 3s → ${t <= 200 ? 'STOPPED by guard' : 'INFINITE LOOP'}`);
}

console.log('--- LEGACY MODE ---');
await runTest(
  'Legacy + SYNC setState ',
  (App) => ReactDOM.render(React.createElement(App), document.getElementById('r1')),
  false
);
await runTest(
  'Legacy + ASYNC setState',
  (App) => ReactDOM.render(React.createElement(App), document.getElementById('r2')),
  true
);

console.log('\n--- CONCURRENT MODE ---');
await runTest(
  'Concurrent + SYNC setState ',
  (App) => createRoot(document.getElementById('r3')).render(React.createElement(App)),
  false
);
await runTest(
  'Concurrent + ASYNC setState',
  (App) => createRoot(document.getElementById('r4')).render(React.createElement(App)),
  true
);

process.exit(0);

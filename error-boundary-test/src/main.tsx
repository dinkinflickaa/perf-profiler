import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Using createRoot (concurrent mode) — this is where the real bypass lives.
// In concurrent mode, async setState from componentDidCatch gets a non-sync
// lane (DefaultEventPriority), so React's nestedUpdateCount resets to 0
// every commit. The loop never hits the 50-iteration limit.
createRoot(document.getElementById('root')!).render(
  <App />
);

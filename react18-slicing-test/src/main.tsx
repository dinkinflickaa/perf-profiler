import { createRoot } from 'react-dom/client';
import { App } from './App';

// NOTE: No StrictMode — StrictMode double-invokes effects/renders in dev,
// which would distort the timing measurements. We want clean numbers.
createRoot(document.getElementById('root')!).render(<App />);

import {
  useEffect,
  useLayoutEffect,
  useState,
  useTransition,
  useRef,
  useCallback,
  memo,
} from 'react';

// =============================================================================
// Cost configuration — every Child does this much synchronous work per render.
// Override via URL ?render=10&layout=5&layoutCleanup=5&passive=5&passiveCleanup=5
// =============================================================================
const params = new URLSearchParams(window.location.search);
const num = (key: string, def: number) => {
  const v = params.get(key);
  return v != null && !Number.isNaN(Number(v)) ? Number(v) : def;
};
const RENDER_COST_MS = num('render', 10);
const LAYOUT_EFFECT_COST_MS = num('layout', 5);
const LAYOUT_CLEANUP_COST_MS = num('layoutCleanup', 5);
const PASSIVE_EFFECT_COST_MS = num('passive', 5);
const PASSIVE_CLEANUP_COST_MS = num('passiveCleanup', 5);
const CHILD_COUNT = num('count', 500);

function busyWait(ms: number) {
  if (ms <= 0) return;
  const end = performance.now() + ms;
  // tight loop — performance.now keeps the wait roughly accurate
  while (performance.now() < end) {
    // burn cycles
  }
}

// =============================================================================
// Child component — synthetic CPU work in render + both effect kinds
// =============================================================================
type ChildProps = { value: number; index: number };

const Child = memo(function Child({ value, index }: ChildProps) {
  busyWait(RENDER_COST_MS);

  useLayoutEffect(() => {
    busyWait(LAYOUT_EFFECT_COST_MS);
    return () => {
      busyWait(LAYOUT_CLEANUP_COST_MS);
    };
  }, [value]);

  useEffect(() => {
    busyWait(PASSIVE_EFFECT_COST_MS);
    return () => {
      busyWait(PASSIVE_CLEANUP_COST_MS);
    };
  }, [value]);

  return (
    <div className="cell" data-idx={index}>
      {index}:{value}
    </div>
  );
});

// =============================================================================
// Parent — owns the state that drives all 500 children
// =============================================================================
type Mode = 'sync' | 'transition';

export function App() {
  const [value, setValue] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<string>('');

  // We need to know which click is "in flight" so we can mark paint-end
  // exactly once per click and ignore unrelated re-renders.
  const inflightRef = useRef<{
    mode: Mode;
    startedAt: number;
    rafCount: number;
    rafLoopRunning: boolean;
  } | null>(null);

  // Continuously schedule rAFs from click-start until paint-end so we can
  // count how many browser frames the page actually painted while React
  // was working. In the sync case the main thread is blocked so the count
  // is ~0. In the transition case the browser keeps painting old UI between
  // sliced renders, so the count is much higher.
  const startRafLoop = useCallback(() => {
    const inflight = inflightRef.current;
    if (!inflight || inflight.rafLoopRunning) return;
    inflight.rafLoopRunning = true;
    const tick = () => {
      const cur = inflightRef.current;
      if (!cur || !cur.rafLoopRunning) return;
      cur.rafCount += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  // After commit, useLayoutEffect runs synchronously BEFORE the browser paints.
  // We mark commit-end, then schedule TWO measurements:
  //   1. first-paint: double-rAF — second rAF fires after the first frame
  //      paints, so this captures click-to-first-paint-of-new-state.
  //   2. all-effects-done: rAF + setTimeout(0) — fires after passive effects
  //      have run, so this captures click-to-fully-settled.
  useLayoutEffect(() => {
    const inflight = inflightRef.current;
    if (!inflight) return;
    if (value === 0) return;

    const commitEnd = performance.now();
    performance.mark(`${inflight.mode}-commit-end`);
    performance.measure(
      `${inflight.mode}-click-to-commit`,
      `${inflight.mode}-click-start`,
      `${inflight.mode}-commit-end`,
    );

    let firstPaintTime = 0;
    requestAnimationFrame(() => {
      // We are inside a rAF callback — paint of THIS frame has not yet happened.
      // Schedule another rAF: when it fires, the previous frame has been painted.
      requestAnimationFrame(() => {
        firstPaintTime = performance.now();
        performance.mark(`${inflight.mode}-first-paint`);
        performance.measure(
          `${inflight.mode}-click-to-first-paint`,
          `${inflight.mode}-click-start`,
          `${inflight.mode}-first-paint`,
        );
      });
    });

    // Separate "all effects + paint" measurement: rAF + setTimeout lets passive
    // effects run before we mark, so this captures the fully settled time.
    requestAnimationFrame(() => {
      setTimeout(() => {
        const allDone = performance.now();
        performance.mark(`${inflight.mode}-all-done`);
        performance.measure(
          `${inflight.mode}-click-to-all-done`,
          `${inflight.mode}-click-start`,
          `${inflight.mode}-all-done`,
        );

        // Stop the rAF counter now
        if (inflightRef.current) inflightRef.current.rafLoopRunning = false;

        const commitDuration = commitEnd - inflight.startedAt;
        const fpDuration = firstPaintTime - inflight.startedAt;
        const allDoneDuration = allDone - inflight.startedAt;
        const result =
          `${inflight.mode}: ` +
          `click→commit=${commitDuration.toFixed(1)}ms, ` +
          `click→firstPaint=${fpDuration.toFixed(1)}ms, ` +
          `click→allDone=${allDoneDuration.toFixed(1)}ms, ` +
          `framesDuringWork=${inflight.rafCount}`;
        // eslint-disable-next-line no-console
        console.log('[result]', result);
        setLastResult(result);
        inflightRef.current = null;
      }, 0);
    });
  }, [value]);

  const runSync = () => {
    performance.mark('sync-click-start');
    inflightRef.current = {
      mode: 'sync',
      startedAt: performance.now(),
      rafCount: 0,
      rafLoopRunning: false,
    };
    startRafLoop();
    // Defer the state update to the next animation frame so that the
    // click handler returns immediately and the render begins in rAF.
    requestAnimationFrame(() => {
      performance.mark('sync-render-scheduled');
      setValue((v) => v + 1);
    });
  };

  const runTransition = () => {
    performance.mark('transition-click-start');
    inflightRef.current = {
      mode: 'transition',
      startedAt: performance.now(),
      rafCount: 0,
      rafLoopRunning: false,
    };
    startRafLoop();
    requestAnimationFrame(() => {
      performance.mark('transition-render-scheduled');
      startTransition(() => {
        setValue((v) => v + 1);
      });
    });
  };

  const reset = () => {
    inflightRef.current = null;
    setValue(0);
    setLastResult('');
    performance.clearMarks();
    performance.clearMeasures();
  };

  return (
    <>
      <div className="toolbar">
        <button onClick={runSync} id="btn-sync">
          Test 1: sync rerender (rAF)
        </button>
        <button onClick={runTransition} id="btn-transition">
          Test 2: transition rerender (rAF + startTransition)
        </button>
        <button onClick={reset} id="btn-reset">
          Reset
        </button>
        <span className="stat">value={value}</span>
        <span className="stat">pending={String(isPending)}</span>
        <span className="stat">{lastResult}</span>
      </div>
      <div className="grid">
        {Array.from({ length: CHILD_COUNT }, (_, i) => (
          <Child key={i} index={i} value={value} />
        ))}
      </div>
    </>
  );
}

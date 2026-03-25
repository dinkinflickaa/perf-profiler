import React, { useState, useLayoutEffect, useEffect, useRef, useCallback } from 'react';

/**
 * Focused experiment: Does the EAGER BAILOUT in dispatchSetState fire
 * when setState(sameValue) is called from useLayoutEffect?
 *
 * React's dispatchSetState has this fast path:
 *
 *   if (fiber.lanes === NoLanes &&
 *       (alternate === null || alternate.lanes === NoLanes)) {
 *     const eagerState = lastRenderedReducer(currentState, action);
 *     if (Object.is(eagerState, currentState)) {
 *       enqueueConcurrentHookUpdateAndEagerlyBailout(...);
 *       return; // ← no scheduleUpdateOnFiber, no re-render
 *     }
 *   }
 *
 * KEY QUESTION: During useLayoutEffect, what are fiber.lanes?
 *
 * Timeline of a commit:
 *   1. Render phase: beginWork sets workInProgress.lanes = NoLanes
 *   2. commitMutationEffects (DOM writes)
 *   3. root.current = finishedWork  (WIP becomes current)
 *   4. commitLayoutEffects — useLayoutEffect fires HERE
 *
 * At step 4:
 *   - fiber (current) = the just-committed WIP. Its lanes were cleared
 *     in beginWork → fiber.lanes === NoLanes ✓
 *   - alternate:
 *     • On INITIAL MOUNT: alternate === null ✓ (no previous tree)
 *     • On RE-RENDER: alternate = old current. Its lanes were the ones
 *       that triggered this render. Were they cleared? NO — React only
 *       clears lanes on the WIP in beginWork, not on the old current.
 *       So alternate.lanes might still have the triggering lane bits.
 *
 * PREDICTION:
 *   - Initial mount + same-value setState in layoutEffect → EAGER bailout
 *     → 1 render total (because alternate === null)
 *   - Re-render + same-value setState in layoutEffect → might NOT get
 *     eager bailout if alternate.lanes !== NoLanes → 2 renders (lazy bailout)
 *
 * Does this differ between legacy and concurrent? Let's find out.
 */

interface Props {
  label: string;
  mode: 'legacy' | 'concurrent';
}

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO A: Same-value setState in layoutEffect — INITIAL MOUNT
//
// On initial mount, alternate === null, so the eager bailout check is:
//   fiber.lanes === NoLanes && (null === null || ...)
// This should pass → eager bailout → component function NOT called again.
//
// How we detect: renderCount stays at 1.
// ─────────────────────────────────────────────────────────────────────────
export function EagerBailoutOnMount({ label, mode }: Props) {
  const renderCount = useRef(0);
  const layoutEffectCount = useRef(0);
  const [value, setValue] = useState(42);
  renderCount.current++;

  useLayoutEffect(() => {
    layoutEffectCount.current++;
    console.log(
      `[${label}][A:Mount] useLayoutEffect #${layoutEffectCount.current} — ` +
      `calling setValue(42) (same value). Renders so far: ${renderCount.current}`
    );
    setValue(42); // same value
  });

  console.log(
    `[${label}][A:Mount] RENDER #${renderCount.current}, value=${value}`
  );

  return (
    <div>
      <strong>A — Same value on mount:</strong>{' '}
      renders={renderCount.current}, layoutEffects={layoutEffectCount.current}
      {renderCount.current === 1 ? (
        <span style={{ color: 'green' }}> ✓ EAGER BAILOUT (1 render)</span>
      ) : renderCount.current === 2 ? (
        <span style={{ color: 'orange' }}> ⚠ LAZY BAILOUT (2 renders)</span>
      ) : (
        <span style={{ color: 'red' }}> ✗ UNEXPECTED ({renderCount.current} renders)</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO B: Same-value setState in layoutEffect — AFTER RE-RENDER
//
// Trigger a re-render first (via button click), then on that re-render,
// layoutEffect calls setState(sameValue).
//
// Now alternate !== null. The question: alternate.lanes === NoLanes?
//
// In the re-render triggered by the button click:
//   - Button click → setState → scheduleUpdateOnFiber with SyncLane
//   - beginWork clears WIP.lanes = NoLanes
//   - After commit, WIP (lanes=NoLanes) becomes current (= fiber in dispatch)
//   - Old current becomes alternate — but its lanes had SyncLane from the
//     button setState. Were they cleared? Only if React explicitly removed
//     the rendered lanes from the old current during commit.
//
// React DOES clear rendered lanes in commitRootImpl:
//   remainingLanes = mergeLanes(remainingLanes, ...)
//   root.pendingLanes = remainingLanes
// But this is on the ROOT, not on individual fibers.
//
// Individual fiber lanes: React removes consumed lanes during beginWork
// on the WIP. The alternate's lanes are NOT explicitly cleared.
// HOWEVER — on the next render, beginWork clones current → WIP and sets
// WIP.lanes = NoLanes. The current's lanes persist until they're the
// basis for a new WIP clone.
//
// So: alternate.lanes may still have SyncLane → eager bailout FAILS
// → lazy bailout (2 renders from that re-render).
// ─────────────────────────────────────────────────────────────────────────
export function EagerBailoutOnRerender({ label, mode }: Props) {
  const renderCount = useRef(0);
  const layoutEffectCount = useRef(0);
  const phaseRef = useRef<'idle' | 'rerender'>('idle');
  const [trigger, setTrigger] = useState(0);
  const [value, setValue] = useState(42);
  renderCount.current++;

  const rendersAtPhaseStart = useRef(0);

  useLayoutEffect(() => {
    layoutEffectCount.current++;
    if (phaseRef.current === 'rerender') {
      console.log(
        `[${label}][B:Rerender] useLayoutEffect #${layoutEffectCount.current} — ` +
        `calling setValue(42) (same value) DURING RE-RENDER. ` +
        `Renders since phase start: ${renderCount.current - rendersAtPhaseStart.current}`
      );
      setValue(42); // same value — will eager bailout fire?
      phaseRef.current = 'idle'; // only do it once
    }
  });

  console.log(
    `[${label}][B:Rerender] RENDER #${renderCount.current}, ` +
    `trigger=${trigger}, value=${value}, phase=${phaseRef.current}`
  );

  const handleClick = useCallback(() => {
    rendersAtPhaseStart.current = renderCount.current;
    phaseRef.current = 'rerender';
    setTrigger(prev => prev + 1); // force a re-render
  }, []);

  const rendersSincePhaseStart = renderCount.current - rendersAtPhaseStart.current;

  return (
    <div>
      <strong>B — Same value on re-render:</strong>{' '}
      renders={renderCount.current}, trigger={trigger}{' '}
      <button onClick={handleClick} style={{ marginLeft: 8 }}>
        Trigger re-render + layoutEffect setValue(same)
      </button>
      {trigger > 0 && phaseRef.current === 'idle' && (
        <div style={{ marginTop: 4, paddingLeft: 16, fontSize: 13 }}>
          Last cycle: {rendersSincePhaseStart <= 1 ? (
            <span style={{ color: 'green' }}>✓ EAGER BAILOUT (only the trigger render)</span>
          ) : rendersSincePhaseStart === 2 ? (
            <span style={{ color: 'orange' }}>⚠ LAZY BAILOUT (+1 extra render)</span>
          ) : (
            <span style={{ color: 'red' }}>✗ {rendersSincePhaseStart} extra renders</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO C: Updater function that returns same value — layoutEffect
//
// setState(prev => prev) instead of setState(42).
// dispatchSetState eager path uses lastRenderedReducer (basicStateReducer):
//   basicStateReducer(state, action) {
//     return typeof action === 'function' ? action(state) : action;
//   }
// So it CAN eagerly evaluate updater functions.
// Question: does the eager path fire for updater functions in layoutEffect?
// ─────────────────────────────────────────────────────────────────────────
export function EagerBailoutUpdaterFn({ label, mode }: Props) {
  const renderCount = useRef(0);
  const [value, setValue] = useState(42);
  renderCount.current++;

  useLayoutEffect(() => {
    console.log(
      `[${label}][C:Updater] useLayoutEffect — setValue(prev => prev), render #${renderCount.current}`
    );
    setValue(prev => prev); // updater returns same value
  });

  console.log(`[${label}][C:Updater] RENDER #${renderCount.current}, value=${value}`);

  return (
    <div>
      <strong>C — Updater fn (prev =&gt; prev) on mount:</strong>{' '}
      renders={renderCount.current}
      {renderCount.current === 1 ? (
        <span style={{ color: 'green' }}> ✓ EAGER BAILOUT (1 render)</span>
      ) : renderCount.current === 2 ? (
        <span style={{ color: 'orange' }}> ⚠ LAZY BAILOUT (2 renders)</span>
      ) : (
        <span style={{ color: 'red' }}> ✗ UNEXPECTED ({renderCount.current} renders)</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO D: Compare useLayoutEffect vs useEffect — same-value setState
//
// useEffect fires AFTER paint (async). By that time, the commit is fully
// done and the browser has painted. fiber.lanes should definitely be NoLanes
// and alternate.lanes should be NoLanes (React clears during commit finish).
//
// This gives us a baseline: if useEffect gets eager bailout but useLayoutEffect
// doesn't (or vice versa), we know the timing matters.
// ─────────────────────────────────────────────────────────────────────────
export function LayoutVsEffectComparison({ label, mode }: Props) {
  return (
    <div>
      <strong>D — useLayoutEffect vs useEffect comparison:</strong>
      <div style={{ paddingLeft: 16, marginTop: 4 }}>
        <EffectChild label={label} effectType="layout" />
        <EffectChild label={label} effectType="passive" />
      </div>
    </div>
  );
}

function EffectChild({ label, effectType }: { label: string; effectType: 'layout' | 'passive' }) {
  const renderCount = useRef(0);
  const [value, setValue] = useState(99);
  renderCount.current++;

  const effectHook = effectType === 'layout' ? useLayoutEffect : useEffect;

  effectHook(() => {
    console.log(
      `[${label}][D:${effectType}] ${effectType}Effect — setValue(99), render #${renderCount.current}`
    );
    setValue(99); // same value
  });

  console.log(`[${label}][D:${effectType}] RENDER #${renderCount.current}, value=${value}`);

  return (
    <div style={{ fontSize: 13 }}>
      {effectType === 'layout' ? 'useLayoutEffect' : 'useEffect'}:{' '}
      renders={renderCount.current}
      {renderCount.current === 1 ? (
        <span style={{ color: 'green' }}> ✓ EAGER (1 render)</span>
      ) : renderCount.current === 2 ? (
        <span style={{ color: 'orange' }}> ⚠ LAZY (2 renders)</span>
      ) : (
        <span style={{ color: 'red' }}> ✗ {renderCount.current} renders</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO E: New value on mount — proves non-bailout path works
//
// Control: setState(DIFFERENT) in layoutEffect → should NEVER bailout.
// Expect: 2 renders (mount + re-render with new value), then layoutEffect
// fires again with same-value → bailout → stops at 2 or 3.
// ─────────────────────────────────────────────────────────────────────────
export function NoBailoutControl({ label, mode }: Props) {
  const renderCount = useRef(0);
  const [value, setValue] = useState(0);
  renderCount.current++;

  useLayoutEffect(() => {
    console.log(
      `[${label}][E:Control] useLayoutEffect — value=${value}, render #${renderCount.current}`
    );
    if (value === 0) {
      setValue(1); // DIFFERENT value → no bailout → re-render
    }
    // value === 1 → no setState → stops
  });

  console.log(`[${label}][E:Control] RENDER #${renderCount.current}, value=${value}`);

  return (
    <div>
      <strong>E — Different value then stop (control):</strong>{' '}
      renders={renderCount.current}, value={value}
      {renderCount.current === 2 && value === 1 ? (
        <span style={{ color: 'green' }}> ✓ Correct (2 renders: mount→setState(1)→done)</span>
      ) : renderCount.current > 2 ? (
        <span style={{ color: 'red' }}> ✗ Too many renders</span>
      ) : null}
    </div>
  );
}

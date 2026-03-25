import React, { useState, useEffect } from 'react';
import { SlotErrorBoundary } from './SlotErrorBoundary';
import { BrokenComponent } from './BrokenComponent';

/**
 * Simulates an Apollo-like parent that:
 *  1. Fetches data via a microtask (Promise.resolve)
 *  2. Each "fetch" produces a new correlationId
 *  3. The child component throws on render using that data
 *
 * This creates the infinite loop:
 *   Apollo resolves (microtask) -> parent re-renders with new correlationId ->
 *   SlotErrorBoundary sees mismatch -> reloadCallback() clears error ->
 *   children re-mount -> BrokenComponent throws -> boundary catches ->
 *   Apollo resolves again (still subscribed) -> new correlationId -> loop
 */

let queryCount = 0;

export function ApolloParent() {
  const [correlationId, setCorrelationId] = useState('corr-0');
  const [, setData] = useState<string | null>(null);

  useEffect(() => {
    // Simulates Apollo's observable: every time the component renders,
    // the subscription fires a microtask that delivers "new" data with
    // a new correlationId — just like a real Apollo cache broadcast.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      queryCount++;
      const newCorrId = `corr-${queryCount}`;
      console.log(
        `[ApolloParent] query #${queryCount} resolved (microtask) — ` +
        `setting correlationId="${newCorrId}"`
      );
      setCorrelationId(newCorrId);
      setData(`data-${queryCount}`);
    });
    return () => { cancelled = true; };
  }); // no deps — runs every render, like an Apollo subscription callback

  return (
    <SlotErrorBoundary correlationId={correlationId}>
      <BrokenComponent />
    </SlotErrorBoundary>
  );
}

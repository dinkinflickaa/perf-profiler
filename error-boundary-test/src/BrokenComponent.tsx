import React from 'react';

let throwCount = 0;

// This component always throws during render
export function BrokenComponent() {
  throwCount++;
  console.log(`[BrokenComponent] render attempt #${throwCount} — about to throw`);
  throw new Error(`BrokenComponent: explosion #${throwCount}!`);
  return <div>You will never see this</div>;
}

import React from 'react';

// This component always throws during render
export function BrokenComponent() {
  throw new Error('BrokenComponent: I always explode during render!');
  return <div>You will never see this</div>;
}

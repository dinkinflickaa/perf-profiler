import type { Profile } from '../../../types.js';

export const fixtureProfileFast: Profile = {
  nodes: [
    { id: 1, callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1 }, hitCount: 0, children: [2] },
    { id: 2, callFrame: { functionName: 'funcA', scriptId: '1', url: 'app.js', lineNumber: 10, columnNumber: 0 }, hitCount: 5, children: [3] },
    { id: 3, callFrame: { functionName: 'funcB', scriptId: '1', url: 'app.js', lineNumber: 20, columnNumber: 0 }, hitCount: 3, children: [] },
  ],
  startTime: 0, endTime: 8000,
  samples: [2, 2, 2, 2, 2, 3, 3, 3],
  timeDeltas: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
};

export const fixtureProfileSlow: Profile = {
  nodes: [
    { id: 1, callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1 }, hitCount: 0, children: [2] },
    { id: 2, callFrame: { functionName: 'funcA', scriptId: '1', url: 'app.js', lineNumber: 10, columnNumber: 0 }, hitCount: 50, children: [3, 4] },
    { id: 3, callFrame: { functionName: 'funcB', scriptId: '1', url: 'app.js', lineNumber: 20, columnNumber: 0 }, hitCount: 30, children: [] },
    { id: 4, callFrame: { functionName: 'funcC', scriptId: '2', url: 'lib.js', lineNumber: 5, columnNumber: 0 }, hitCount: 20, children: [] },
  ],
  startTime: 0, endTime: 100000, samples: [], timeDeltas: [],
};

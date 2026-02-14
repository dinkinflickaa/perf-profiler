import { describe, it, expect } from 'vitest';
import { compareProfiles } from '../profile-comparator.js';
import { aggregateByFunction } from '../profile-parser.js';
import { fixtureProfileFast, fixtureProfileSlow } from './fixtures/index.js';

describe('aggregateByFunction', () => {
  it('aggregates hitCount by function key', () => {
    const agg = aggregateByFunction(fixtureProfileFast);
    expect(agg.get('funcA:app.js:10')).toBe(5);
    expect(agg.get('funcB:app.js:20')).toBe(3);
  });

  it('skips (root) node', () => {
    const agg = aggregateByFunction(fixtureProfileFast);
    expect(agg.has('(root)::-1')).toBe(false);
  });
});

describe('compareProfiles', () => {
  it('finds functions that got hotter', () => {
    const diffs = compareProfiles(fixtureProfileFast, fixtureProfileSlow, 10);
    const funcA = diffs.find(d => d.functionName === 'funcA');
    expect(funcA).toBeDefined();
    expect(funcA!.delta).toBe(45);
  });

  it('detects new functions in slow profile', () => {
    const diffs = compareProfiles(fixtureProfileFast, fixtureProfileSlow, 10);
    const funcC = diffs.find(d => d.functionName === 'funcC');
    expect(funcC).toBeDefined();
    expect(funcC!.hitsA).toBe(0);
    expect(funcC!.hitsB).toBe(20);
  });

  it('sorts by absolute delta descending', () => {
    const diffs = compareProfiles(fixtureProfileFast, fixtureProfileSlow, 10);
    for (let i = 1; i < diffs.length; i++) {
      expect(Math.abs(diffs[i].delta)).toBeLessThanOrEqual(Math.abs(diffs[i - 1].delta));
    }
  });
});

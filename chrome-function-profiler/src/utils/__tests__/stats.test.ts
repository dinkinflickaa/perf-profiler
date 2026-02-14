import { describe, it, expect } from 'vitest';
import { computeStats, detectOutliers } from '../stats.js';

describe('computeStats', () => {
  it('computes stats for a simple dataset', () => {
    const result = computeStats([10, 20, 30, 40, 50]);
    expect(result.min).toBe(10);
    expect(result.max).toBe(50);
    expect(result.avg).toBe(30);
    expect(result.p50).toBe(30);
    expect(result.stddev).toBeCloseTo(14.14, 1);
  });

  it('computes p95 correctly', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const result = computeStats(values);
    expect(result.p95).toBeCloseTo(19.05, 5);
  });

  it('handles single value', () => {
    const result = computeStats([42]);
    expect(result.min).toBe(42);
    expect(result.max).toBe(42);
    expect(result.avg).toBe(42);
    expect(result.p50).toBe(42);
    expect(result.stddev).toBe(0);
  });

  it('throws on empty array', () => {
    expect(() => computeStats([])).toThrow();
  });
});

describe('detectOutliers', () => {
  it('detects outliers beyond 2 stddev', () => {
    const items = [
      { label: 'a', value: 10 }, { label: 'b', value: 11 }, { label: 'c', value: 9 },
      { label: 'd', value: 10 }, { label: 'e', value: 11 }, { label: 'f', value: 10 },
      { label: 'g', value: 9 }, { label: 'h', value: 10 }, { label: 'i', value: 11 },
      { label: 'outlier', value: 100 },
    ];
    const outliers = detectOutliers(items, 2);
    expect(outliers).toHaveLength(1);
    expect(outliers[0].label).toBe('outlier');
    expect(outliers[0].zscore).toBeGreaterThan(2);
  });

  it('returns empty for uniform data', () => {
    const items = [
      { label: 'a', value: 10 }, { label: 'b', value: 10 }, { label: 'c', value: 10 },
    ];
    expect(detectOutliers(items, 2)).toHaveLength(0);
  });
});

import type { StatsResult } from '../types.js';

export function computeStats(values: number[]): StatsResult {
  if (values.length === 0) throw new Error('Cannot compute stats on empty array');

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / n;

  const variance = sorted.reduce((acc, v) => acc + (v - avg) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  return {
    min: sorted[0],
    max: sorted[n - 1],
    avg,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    stddev,
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function detectOutliers(
  items: Array<{ label: string; value: number }>,
  threshold: number = 2
): Array<{ label: string; value: number; zscore: number }> {
  if (items.length < 3) return [];

  const values = items.map(i => i.value);
  const { avg, stddev } = computeStats(values);
  if (stddev === 0) return [];

  return items
    .map(item => ({
      label: item.label,
      value: item.value,
      zscore: Math.abs(item.value - avg) / stddev,
    }))
    .filter(item => item.zscore > threshold);
}

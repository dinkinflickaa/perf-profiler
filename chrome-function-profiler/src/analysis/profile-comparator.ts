import type { Profile, FunctionDiff } from '../types.js';
import { aggregateByFunction } from './profile-parser.js';

export function compareProfiles(profileA: Profile, profileB: Profile, topN: number = 20): FunctionDiff[] {
  const aggA = aggregateByFunction(profileA);
  const aggB = aggregateByFunction(profileB);
  const totalA = sumValues(aggA);
  const totalB = sumValues(aggB);
  const allKeys = new Set([...aggA.keys(), ...aggB.keys()]);
  const diffs: FunctionDiff[] = [];
  for (const key of allKeys) {
    const [functionName, url, lineStr] = key.split(':');
    const lineNumber = parseInt(lineStr, 10);
    const hitsA = aggA.get(key) ?? 0;
    const hitsB = aggB.get(key) ?? 0;
    diffs.push({
      functionName, url, lineNumber, hitsA, hitsB,
      delta: hitsB - hitsA,
      percentA: totalA > 0 ? (hitsA / totalA) * 100 : 0,
      percentB: totalB > 0 ? (hitsB / totalB) * 100 : 0,
    });
  }
  diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return diffs.slice(0, topN);
}

function sumValues(map: Map<string, number>): number {
  let sum = 0;
  for (const v of map.values()) sum += v;
  return sum;
}

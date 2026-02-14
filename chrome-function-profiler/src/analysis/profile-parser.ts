import type { Profile } from '../types.js';

export function aggregateByFunction(profile: Profile): Map<string, number> {
  const agg = new Map<string, number>();
  for (const node of profile.nodes) {
    const { functionName, url, lineNumber } = node.callFrame;
    if (!functionName || functionName === '(root)' || functionName === '(idle)' || functionName === '(program)') continue;
    const key = `${functionName}:${url}:${lineNumber}`;
    agg.set(key, (agg.get(key) ?? 0) + (node.hitCount ?? 0));
  }
  return agg;
}

export function topFunctions(profile: Profile, n: number = 10): Array<{ functionName: string; url: string; lineNumber: number; hitCount: number }> {
  const entries: Array<{ functionName: string; url: string; lineNumber: number; hitCount: number }> = [];
  for (const node of profile.nodes) {
    const { functionName, url, lineNumber } = node.callFrame;
    if (!functionName || functionName === '(root)' || functionName === '(idle)' || functionName === '(program)') continue;
    if ((node.hitCount ?? 0) > 0) entries.push({ functionName, url, lineNumber, hitCount: node.hitCount ?? 0 });
  }
  entries.sort((a, b) => b.hitCount - a.hitCount);
  return entries.slice(0, n);
}

export function profileDurationMs(profile: Profile): number {
  return (profile.endTime - profile.startTime) / 1000;
}

# Chrome Function Profiler — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that connects to Chrome via CDP and provides scenario-scoped CPU profiling triggered by `performance.mark` pairs, plus a demo chat app for validation.

**Architecture:** Two independent packages — `chrome-function-profiler/` (MCP server) and `demo-app/` (Vite + React). The MCP server patches `performance.mark` to inject `console.profile()`/`console.profileEnd()` for zero-latency profiler start/stop. Profiles arrive via `Profiler.consoleProfileFinished` CDP events.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `chrome-remote-interface`, `zod`, Vite, React

**Full spec:** `chrome-function-profiler-plan.md` (root of repo) — contains all CDP details, injected code, edge cases.

---

## Parallel Execution Structure

This plan is organized by **agent** for parallel execution. Wave 1 agents have zero dependencies on each other. Wave 2 depends on Wave 1. Wave 3 depends on Wave 2.

```
Wave 1 (parallel):
  Agent A: foundation     — scaffolding, CDP layer, stats, comparator
  Agent B: instrumentation — mark patcher, navigation handler
  Agent C: demo-app       — Vite + React chat channel viewer

Wave 2 (sequential, after Wave 1):
  Agent D: profiler-session — CPU profiler, session manager

Wave 3 (sequential, after Wave 2):
  Agent E: mcp-server      — MCP entry point + all tool handlers
```

---

## Agent A: Foundation (Wave 1)

### Task A1: Scaffold MCP server project

**Files:**
- Create: `chrome-function-profiler/package.json`
- Create: `chrome-function-profiler/tsconfig.json`
- Create: `chrome-function-profiler/src/types.ts`

**Step 1: Create package.json**

```json
{
  "name": "chrome-function-profiler-mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "chrome-function-profiler": "./build/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^2.0.0",
    "chrome-remote-interface": "^0.33.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "**/*.test.ts"]
}
```

**Step 3: Create src/types.ts**

This file defines the shared types used across all modules. These types map directly to the CDP `Profile` object structure (see spec section "Profiler.consoleProfileFinished return value").

```typescript
// CDP Profile types (from Profiler.consoleProfileFinished)
export interface CallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  hitCount?: number;
  children?: number[];
}

export interface Profile {
  nodes: ProfileNode[];
  startTime: number;  // microseconds, V8 monotonic clock
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

// Capture metadata
export interface CaptureInfo {
  index: number;
  label: string;
  duration: number;  // milliseconds
  overlappingInvocations: number;
  profile: Profile;
  files: {
    cpu: string;
    network?: string;
  };
}

// Session state
export interface SessionState {
  id: string;
  startMark: string;
  endMark: string;
  target: 'main' | 'worker';
  workerUrl?: string;
  captures: CaptureInfo[];
  captureIndex: number;
  active: boolean;
  startedAt: number;
}

// Worker session info
export interface WorkerSession {
  sessionId: string;
  url: string;
  type: string;
}

// Stats result
export interface StatsResult {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  stddev: number;
}

// Profile comparison result
export interface FunctionDiff {
  functionName: string;
  url: string;
  lineNumber: number;
  hitsA: number;
  hitsB: number;
  delta: number;
  percentA: number;
  percentB: number;
}

// Session summary (returned by stop_profiling_session)
export interface SessionSummary {
  sessionId: string;
  startMark: string;
  endMark: string;
  totalCaptures: number;
  captures: Array<{
    index: number;
    label: string;
    duration: number;
    overlappingInvocations: number;
    files: { cpu: string };
  }>;
  stats: {
    cpu: StatsResult;
  };
  outliers: Array<{
    label: string;
    metric: string;
    value: number;
    zscore: number;
  }>;
}
```

**Step 4: Install dependencies**

Run: `cd chrome-function-profiler && npm install`

**Step 5: Verify TypeScript compiles**

Run: `cd chrome-function-profiler && npx tsc --noEmit`
Expected: No errors (types.ts has no imports)

**Step 6: Commit**

```bash
git add chrome-function-profiler/
git commit -m "feat: scaffold chrome-function-profiler project with types"
```

---

### Task A2: Stats utility with tests

**Files:**
- Create: `chrome-function-profiler/src/utils/stats.ts`
- Create: `chrome-function-profiler/src/utils/__tests__/stats.test.ts`

**Step 1: Write failing tests**

```typescript
// src/utils/__tests__/stats.test.ts
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
    // 20 values: 1..20
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const result = computeStats(values);
    expect(result.p95).toBe(19); // 95th percentile of 1..20
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
    // 9 values near 10, one outlier at 100
    const items = [
      { label: 'a', value: 10 },
      { label: 'b', value: 11 },
      { label: 'c', value: 9 },
      { label: 'd', value: 10 },
      { label: 'e', value: 11 },
      { label: 'f', value: 10 },
      { label: 'g', value: 9 },
      { label: 'h', value: 10 },
      { label: 'i', value: 11 },
      { label: 'outlier', value: 100 },
    ];
    const outliers = detectOutliers(items, 2);
    expect(outliers).toHaveLength(1);
    expect(outliers[0].label).toBe('outlier');
    expect(outliers[0].zscore).toBeGreaterThan(2);
  });

  it('returns empty for uniform data', () => {
    const items = [
      { label: 'a', value: 10 },
      { label: 'b', value: 10 },
      { label: 'c', value: 10 },
    ];
    const outliers = detectOutliers(items, 2);
    expect(outliers).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd chrome-function-profiler && npx vitest run src/utils/__tests__/stats.test.ts`
Expected: FAIL — module not found

**Step 3: Implement stats.ts**

```typescript
// src/utils/stats.ts
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
```

**Step 4: Run tests**

Run: `cd chrome-function-profiler && npx vitest run src/utils/__tests__/stats.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add chrome-function-profiler/src/utils/
git commit -m "feat: add stats utility (percentile, outlier detection)"
```

---

### Task A3: CDP connection manager

**Files:**
- Create: `chrome-function-profiler/src/cdp/connection.ts`
- Create: `chrome-function-profiler/src/cdp/session.ts`
- Create: `chrome-function-profiler/src/cdp/worker-manager.ts`

The CDP layer connects to Chrome's debug port and manages sessions. These modules wrap `chrome-remote-interface`. Testing requires a running Chrome instance, so we write the code without unit tests here — it will be integration-tested with the demo app later.

**Step 1: Create connection.ts**

The connection manager uses DI (constructor injection) — not a module-level singleton. This makes it testable and supports potential multi-instance use.

```typescript
// src/cdp/connection.ts
import CDP from 'chrome-remote-interface';

export interface ConnectionOptions {
  port?: number;
  host?: string;
}

export interface CDPConnection {
  client: CDP.Client;
  port: number;
  host: string;
  close(): Promise<void>;
}

export async function createConnection(
  options: ConnectionOptions = {}
): Promise<CDPConnection> {
  const port = options.port ?? 9222;
  const host = options.host ?? '127.0.0.1';

  const client = await CDP({ port, host });

  return {
    client,
    port,
    host,
    async close() {
      try {
        await client.close();
      } catch {
        // Connection may already be closed
      }
    },
  };
}

export async function listCDPTargets(
  options: ConnectionOptions = {}
): Promise<Array<{ id: string; type: string; url: string; title: string }>> {
  const port = options.port ?? 9222;
  const host = options.host ?? '127.0.0.1';

  const targets = await CDP.List({ port, host });
  return targets.map((t: any) => ({
    id: t.id,
    type: t.type,
    url: t.url,
    title: t.title,
  }));
}
```

**Step 2: Create session.ts**

Wraps CDP commands with optional sessionId routing for worker targets.

```typescript
// src/cdp/session.ts
import type CDP from 'chrome-remote-interface';

export async function sendCommand(
  client: CDP.Client,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string
): Promise<any> {
  if (sessionId) {
    return client.send(method as any, { ...params, sessionId } as any);
  }
  return client.send(method as any, params as any);
}

export async function enableProfiler(
  client: CDP.Client,
  samplingInterval: number = 200,
  sessionId?: string
): Promise<void> {
  await sendCommand(client, 'Profiler.enable', {}, sessionId);
  await sendCommand(
    client,
    'Profiler.setSamplingInterval',
    { interval: samplingInterval },
    sessionId
  );
}

export async function enableRuntime(
  client: CDP.Client,
  sessionId?: string
): Promise<void> {
  await sendCommand(client, 'Runtime.enable', {}, sessionId);
}

export async function evaluate(
  client: CDP.Client,
  expression: string,
  sessionId?: string
): Promise<any> {
  const result = await sendCommand(
    client,
    'Runtime.evaluate',
    { expression, returnByValue: true },
    sessionId
  );
  return result?.result?.value;
}
```

**Step 3: Create worker-manager.ts**

Discovers and tracks worker targets via `Target.setAutoAttach`.

```typescript
// src/cdp/worker-manager.ts
import type CDP from 'chrome-remote-interface';
import type { WorkerSession } from '../types.js';

export class WorkerManager {
  private workers = new Map<string, WorkerSession>();
  private client: CDP.Client;

  constructor(client: CDP.Client) {
    this.client = client;
  }

  async start(): Promise<void> {
    this.client.on('Target.attachedToTarget' as any, (event: any) => {
      const { sessionId, targetInfo } = event;
      if (targetInfo.type === 'worker' || targetInfo.type === 'service_worker') {
        this.workers.set(sessionId, {
          sessionId,
          url: targetInfo.url,
          type: targetInfo.type,
        });
      }
    });

    this.client.on('Target.detachedFromTarget' as any, (event: any) => {
      this.workers.delete(event.sessionId);
    });

    await (this.client as any).send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
  }

  getWorkers(): WorkerSession[] {
    return Array.from(this.workers.values());
  }

  findByUrl(urlFragment: string): WorkerSession[] {
    return this.getWorkers().filter(w => w.url.includes(urlFragment));
  }

  getSessionId(urlFragment?: string): string | undefined {
    if (!urlFragment) return undefined; // main thread
    const matches = this.findByUrl(urlFragment);
    if (matches.length === 1) return matches[0].sessionId;
    if (matches.length > 1) {
      throw new Error(
        `Multiple workers match "${urlFragment}": ${matches.map(m => m.url).join(', ')}. Use list_targets to disambiguate.`
      );
    }
    throw new Error(`No worker found matching "${urlFragment}".`);
  }

  clear(): void {
    this.workers.clear();
  }
}
```

**Step 4: Verify TypeScript compiles**

Run: `cd chrome-function-profiler && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add chrome-function-profiler/src/cdp/
git commit -m "feat: add CDP connection, session, and worker manager"
```

---

### Task A4: Profile parser and comparator with tests

**Files:**
- Create: `chrome-function-profiler/src/analysis/profile-parser.ts`
- Create: `chrome-function-profiler/src/analysis/profile-comparator.ts`
- Create: `chrome-function-profiler/src/analysis/__tests__/profile-comparator.test.ts`
- Create: `chrome-function-profiler/src/analysis/__tests__/fixtures/`

**Step 1: Create a test fixture**

Create a minimal .cpuprofile fixture for testing. The format matches what CDP returns in `Profiler.consoleProfileFinished`.

```typescript
// src/analysis/__tests__/fixtures/index.ts
import type { Profile } from '../../../types.js';

// A simple profile with 3 functions: (root) -> funcA -> funcB
export const fixtureProfileFast: Profile = {
  nodes: [
    { id: 1, callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1 }, hitCount: 0, children: [2] },
    { id: 2, callFrame: { functionName: 'funcA', scriptId: '1', url: 'app.js', lineNumber: 10, columnNumber: 0 }, hitCount: 5, children: [3] },
    { id: 3, callFrame: { functionName: 'funcB', scriptId: '1', url: 'app.js', lineNumber: 20, columnNumber: 0 }, hitCount: 3, children: [] },
  ],
  startTime: 0,
  endTime: 8000,  // 8ms in microseconds
  samples: [2, 2, 2, 2, 2, 3, 3, 3],
  timeDeltas: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
};

// Same functions but funcA is much hotter (simulates a slow scenario)
export const fixtureProfileSlow: Profile = {
  nodes: [
    { id: 1, callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1 }, hitCount: 0, children: [2] },
    { id: 2, callFrame: { functionName: 'funcA', scriptId: '1', url: 'app.js', lineNumber: 10, columnNumber: 0 }, hitCount: 50, children: [3, 4] },
    { id: 3, callFrame: { functionName: 'funcB', scriptId: '1', url: 'app.js', lineNumber: 20, columnNumber: 0 }, hitCount: 30, children: [] },
    { id: 4, callFrame: { functionName: 'funcC', scriptId: '2', url: 'lib.js', lineNumber: 5, columnNumber: 0 }, hitCount: 20, children: [] },
  ],
  startTime: 0,
  endTime: 100000,  // 100ms
  samples: [],
  timeDeltas: [],
};
```

**Step 2: Write failing tests for comparator**

```typescript
// src/analysis/__tests__/profile-comparator.test.ts
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
    expect(agg.has('(root)::−1')).toBe(false);
  });
});

describe('compareProfiles', () => {
  it('finds functions that got hotter', () => {
    const diffs = compareProfiles(fixtureProfileFast, fixtureProfileSlow, 10);
    // funcA: 5 hits in fast, 50 in slow → delta 45
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
```

**Step 3: Run tests to verify they fail**

Run: `cd chrome-function-profiler && npx vitest run src/analysis/__tests__/profile-comparator.test.ts`
Expected: FAIL

**Step 4: Implement profile-parser.ts**

```typescript
// src/analysis/profile-parser.ts
import type { Profile, ProfileNode } from '../types.js';

/**
 * Aggregate hitCount by function identity: `functionName:url:lineNumber`
 * Skips nodes with no meaningful function name (root, idle, etc.)
 */
export function aggregateByFunction(profile: Profile): Map<string, number> {
  const agg = new Map<string, number>();

  for (const node of profile.nodes) {
    const { functionName, url, lineNumber } = node.callFrame;
    if (!functionName || functionName === '(root)' || functionName === '(idle)' || functionName === '(program)') {
      continue;
    }
    const key = `${functionName}:${url}:${lineNumber}`;
    agg.set(key, (agg.get(key) ?? 0) + (node.hitCount ?? 0));
  }

  return agg;
}

/**
 * Get top N functions by self-time (hitCount) from a profile.
 */
export function topFunctions(
  profile: Profile,
  n: number = 10
): Array<{ functionName: string; url: string; lineNumber: number; hitCount: number }> {
  const entries: Array<{ functionName: string; url: string; lineNumber: number; hitCount: number }> = [];

  for (const node of profile.nodes) {
    const { functionName, url, lineNumber } = node.callFrame;
    if (!functionName || functionName === '(root)' || functionName === '(idle)' || functionName === '(program)') {
      continue;
    }
    if ((node.hitCount ?? 0) > 0) {
      entries.push({ functionName, url, lineNumber, hitCount: node.hitCount ?? 0 });
    }
  }

  entries.sort((a, b) => b.hitCount - a.hitCount);
  return entries.slice(0, n);
}

/**
 * Compute profile duration in milliseconds from startTime/endTime (microseconds).
 */
export function profileDurationMs(profile: Profile): number {
  return (profile.endTime - profile.startTime) / 1000;
}
```

**Step 5: Implement profile-comparator.ts**

```typescript
// src/analysis/profile-comparator.ts
import type { Profile, FunctionDiff } from '../types.js';
import { aggregateByFunction } from './profile-parser.js';

/**
 * Compare two profiles and return the top N functions with the largest delta.
 * profileA = baseline/fast, profileB = regression/slow.
 */
export function compareProfiles(
  profileA: Profile,
  profileB: Profile,
  topN: number = 20
): FunctionDiff[] {
  const aggA = aggregateByFunction(profileA);
  const aggB = aggregateByFunction(profileB);

  const totalA = sumValues(aggA);
  const totalB = sumValues(aggB);

  // Collect all unique function keys
  const allKeys = new Set([...aggA.keys(), ...aggB.keys()]);

  const diffs: FunctionDiff[] = [];
  for (const key of allKeys) {
    const [functionName, url, lineStr] = key.split(':');
    const lineNumber = parseInt(lineStr, 10);
    const hitsA = aggA.get(key) ?? 0;
    const hitsB = aggB.get(key) ?? 0;
    const delta = hitsB - hitsA;

    diffs.push({
      functionName,
      url,
      lineNumber,
      hitsA,
      hitsB,
      delta,
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
```

**Step 6: Run tests**

Run: `cd chrome-function-profiler && npx vitest run src/analysis/__tests__/profile-comparator.test.ts`
Expected: All PASS

**Step 7: Commit**

```bash
git add chrome-function-profiler/src/analysis/
git commit -m "feat: add profile parser and comparator with tests"
```

---

### Task A5: File output utility

**Files:**
- Create: `chrome-function-profiler/src/utils/file-output.ts`

**Step 1: Implement file-output.ts**

```typescript
// src/utils/file-output.ts
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Profile, SessionSummary } from '../types.js';

/**
 * Save a CDP Profile as a .cpuprofile file (JSON).
 * This format loads directly in Chrome DevTools Performance panel.
 */
export async function saveProfile(profile: Profile, filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
}

/**
 * Save session summary as summary.json.
 */
export async function saveSummary(summary: SessionSummary, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
}

/**
 * Load a .cpuprofile file.
 */
export async function loadProfile(filePath: string): Promise<Profile> {
  const { readFile } = await import('node:fs/promises');
  const data = await readFile(filePath, 'utf-8');
  return JSON.parse(data) as Profile;
}
```

**Step 2: Verify compilation**

Run: `cd chrome-function-profiler && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add chrome-function-profiler/src/utils/file-output.ts
git commit -m "feat: add file output utility for .cpuprofile and summary.json"
```

---

## Agent B: Instrumentation (Wave 1)

> **Prerequisite**: Agent A's Task A1 must complete first (needs `types.ts` and `package.json`). In practice, scaffold the project first, then start Agents A (remaining tasks) and B in parallel.

### Task B1: Mark patcher

**Files:**
- Create: `chrome-function-profiler/src/instrumentation/mark-patcher.ts`
- Create: `chrome-function-profiler/src/instrumentation/__tests__/mark-patcher.test.ts`

The mark patcher generates JavaScript code strings that are injected into the page via `Runtime.evaluate`. The code patches `performance.mark` to call `console.profile()`/`console.profileEnd()`. See spec section "Injected performance.mark patch".

**Step 1: Write failing tests**

We test the code *generation* (that it produces correct JS strings), not the CDP injection.

```typescript
// src/instrumentation/__tests__/mark-patcher.test.ts
import { describe, it, expect } from 'vitest';
import { generateMarkPatch, generateRestorePatch } from '../mark-patcher.js';

describe('generateMarkPatch', () => {
  it('generates valid JavaScript', () => {
    const code = generateMarkPatch('start-mark', 'end-mark', 50);
    // Should be an IIFE
    expect(code).toMatch(/^\(function\(\)/);
    expect(code).toMatch(/\}\)\(\);$/);
  });

  it('includes the start and end mark names', () => {
    const code = generateMarkPatch('my-start', 'my-end', 50);
    expect(code).toContain("'my-start'");
    expect(code).toContain("'my-end'");
  });

  it('includes the maxCaptures limit', () => {
    const code = generateMarkPatch('s', 'e', 42);
    expect(code).toContain('42');
  });

  it('patches performance.mark and stores original', () => {
    const code = generateMarkPatch('s', 'e', 50);
    expect(code).toContain('performance.__originalMark');
    expect(code).toContain('console.profile');
    expect(code).toContain('console.profileEnd');
  });

  it('includes depth tracking for re-entrancy', () => {
    const code = generateMarkPatch('s', 'e', 50);
    expect(code).toContain('depth');
  });
});

describe('generateRestorePatch', () => {
  it('generates restore code', () => {
    const code = generateRestorePatch();
    expect(code).toContain('performance.__originalMark');
    expect(code).toContain('performance.mark');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd chrome-function-profiler && npx vitest run src/instrumentation/__tests__/mark-patcher.test.ts`
Expected: FAIL

**Step 3: Implement mark-patcher.ts**

```typescript
// src/instrumentation/mark-patcher.ts

/**
 * Generate JavaScript code that patches performance.mark to trigger
 * console.profile()/console.profileEnd() on matching mark names.
 *
 * This code is injected into the page/worker via Runtime.evaluate.
 * console.profile() starts the V8 CPU profiler synchronously — zero IPC latency.
 *
 * Re-entrancy: If startMark fires while already profiling (depth > 0),
 * we increment depth but don't start another console.profile(). Only the
 * outermost pair triggers profiling. Overlap count is encoded in the
 * console.profileEnd title for the server to parse.
 */
export function generateMarkPatch(
  startMark: string,
  endMark: string,
  maxCaptures: number
): string {
  // Escape single quotes in mark names for safe embedding in JS string
  const escapedStart = startMark.replace(/'/g, "\\'");
  const escapedEnd = endMark.replace(/'/g, "\\'");

  return `(function() {
  var startMark = '${escapedStart}';
  var endMark = '${escapedEnd}';
  var maxCaptures = ${maxCaptures};
  var origMark = performance.mark.bind(performance);

  var captureIndex = 0;
  var depth = 0;
  var maxDepthThisCapture = 0;

  performance.__originalMark = origMark;

  performance.mark = function(name, options) {
    if (name === startMark && captureIndex < maxCaptures) {
      depth++;
      if (depth > maxDepthThisCapture) maxDepthThisCapture = depth;
      if (depth === 1) {
        captureIndex++;
        console.profile('capture-' + captureIndex);
      }
    }

    var result = origMark(name, options);

    if (name === endMark && depth > 0) {
      depth--;
      if (depth === 0) {
        var title = 'capture-' + captureIndex +
          (maxDepthThisCapture > 1 ? ':overlap-' + maxDepthThisCapture : '');
        maxDepthThisCapture = 0;
        console.profileEnd(title);
      }
    }

    return result;
  };
})();`;
}

/**
 * Generate JavaScript code that restores the original performance.mark.
 */
export function generateRestorePatch(): string {
  return `(function() {
  if (performance.__originalMark) {
    performance.mark = performance.__originalMark;
    delete performance.__originalMark;
  }
})();`;
}

/**
 * Parse the title from a Profiler.consoleProfileFinished event.
 * Title format: "capture-N" or "capture-N:overlap-M"
 */
export function parseCaptureTitle(title: string): {
  captureIndex: number;
  overlapCount: number;
} {
  const match = title.match(/^capture-(\d+)(?::overlap-(\d+))?$/);
  if (!match) {
    return { captureIndex: 0, overlapCount: 1 };
  }
  return {
    captureIndex: parseInt(match[1], 10),
    overlapCount: match[2] ? parseInt(match[2], 10) : 1,
  };
}

/**
 * Generate JavaScript code for auto-labeling captures.
 * Queries the DOM for an active/selected element to use as the capture label.
 * Falls back to URL path or "invocation".
 */
export function generateAutoLabelQuery(): string {
  return `(function() {
  var active = document.querySelector('[aria-selected="true"]')
    || document.querySelector('[aria-current="true"]')
    || document.querySelector('.active[role="treeitem"]')
    || document.querySelector('.selected');
  if (active) return active.textContent?.trim().slice(0, 50);
  return location.hash || location.pathname.split('/').pop() || 'invocation';
})()`;
}
```

**Step 4: Run tests**

Run: `cd chrome-function-profiler && npx vitest run src/instrumentation/__tests__/mark-patcher.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add chrome-function-profiler/src/instrumentation/
git commit -m "feat: add mark patcher for console.profile injection"
```

---

### Task B2: Navigation handler

**Files:**
- Create: `chrome-function-profiler/src/instrumentation/navigation-handler.ts`

The navigation handler re-injects the mark patch when the page navigates (destroying the old execution context). It listens for `Runtime.executionContextCreated` and re-evaluates the patch code.

**Step 1: Implement navigation-handler.ts**

```typescript
// src/instrumentation/navigation-handler.ts
import type CDP from 'chrome-remote-interface';
import { sendCommand } from '../cdp/session.js';

export interface NavigationHandlerOptions {
  client: CDP.Client;
  sessionId?: string;
  patchCode: string;
  onNavigationDetected?: (contextId: number) => void;
  onReinjected?: () => void;
}

export class NavigationHandler {
  private client: CDP.Client;
  private sessionId?: string;
  private patchCode: string;
  private onNavigationDetected?: (contextId: number) => void;
  private onReinjected?: () => void;
  private handler: ((event: any) => void) | null = null;
  private active = false;
  // Track whether a capture was in-flight when navigation happened
  private captureInFlight = false;

  constructor(options: NavigationHandlerOptions) {
    this.client = options.client;
    this.sessionId = options.sessionId;
    this.patchCode = options.patchCode;
    this.onNavigationDetected = options.onNavigationDetected;
    this.onReinjected = options.onReinjected;
  }

  async start(): Promise<void> {
    this.active = true;
    this.handler = async (event: any) => {
      if (!this.active) return;
      // Only re-inject into the default (main) execution context
      if (event.context?.auxData?.isDefault) {
        this.onNavigationDetected?.(event.context.id);
        try {
          await sendCommand(
            this.client,
            'Runtime.evaluate',
            { expression: this.patchCode },
            this.sessionId
          );
          this.onReinjected?.();
        } catch (err) {
          // Context may have been destroyed again — ignore
        }
      }
    };
    this.client.on('Runtime.executionContextCreated' as any, this.handler);
  }

  setCaptureInFlight(inFlight: boolean): void {
    this.captureInFlight = inFlight;
  }

  isCaptureInFlight(): boolean {
    return this.captureInFlight;
  }

  stop(): void {
    this.active = false;
    if (this.handler) {
      this.client.removeListener('Runtime.executionContextCreated' as any, this.handler);
      this.handler = null;
    }
  }
}
```

**Step 2: Verify compilation**

Run: `cd chrome-function-profiler && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add chrome-function-profiler/src/instrumentation/navigation-handler.ts
git commit -m "feat: add navigation handler for mark patch re-injection"
```

---

## Agent C: Demo App (Wave 1)

### Task C1: Scaffold demo app

**Files:**
- Create: `demo-app/package.json`
- Create: `demo-app/tsconfig.json`
- Create: `demo-app/tsconfig.node.json`
- Create: `demo-app/vite.config.ts`
- Create: `demo-app/index.html`

**Step 1: Create package.json**

```json
{
  "name": "demo-chat-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

**Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

**Step 4: Create tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["vite.config.ts"]
}
```

**Step 5: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chat Channel Viewer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 6: Install dependencies**

Run: `cd demo-app && npm install`

**Step 7: Commit**

```bash
git add demo-app/
git commit -m "feat: scaffold demo chat app with Vite + React"
```

---

### Task C2: Types and channel configuration

**Files:**
- Create: `demo-app/src/types.ts`
- Create: `demo-app/src/channels.ts`

**Step 1: Create types.ts**

```typescript
// src/types.ts
export interface Channel {
  id: string;
  name: string;
  messageCount: number;
  hasThreads: boolean;
  category: 'small' | 'medium' | 'large' | 'huge';
}

export interface RawMessage {
  id: string;
  authorId: string;
  content: string;
  timestamp: number;
  threadId?: string;
  reactions: { emoji: string; userIds: string[] }[];
  attachments: { type: string; url: string; size: number }[];
}

export interface ProcessedMessage {
  id: string;
  author: { id: string; name: string; avatar: string };
  contentHtml: string;
  mentions: string[];
  emojis: string[];
  timestamp: number;
  formattedTime: string;
  dateGroup: string;
  threadMessages?: ProcessedMessage[];
  reactionSummary: { emoji: string; count: number; names: string[] }[];
  reactions?: { emoji: string; userIds: string[] }[];
}
```

**Step 2: Create channels.ts**

```typescript
// src/channels.ts
import type { Channel } from './types';

export const CHANNELS: Channel[] = [
  // Small channels — fast scenarios (<10ms)
  { id: 'general',       name: 'General',        messageCount: 50,   hasThreads: false, category: 'small' },
  { id: 'random',        name: 'Random',         messageCount: 80,   hasThreads: false, category: 'small' },
  { id: 'introductions', name: 'Introductions',  messageCount: 30,   hasThreads: false, category: 'small' },

  // Medium channels — moderate scenarios (10-50ms)
  { id: 'engineering',   name: 'Engineering',     messageCount: 500,  hasThreads: true,  category: 'medium' },
  { id: 'design',        name: 'Design',          messageCount: 400,  hasThreads: true,  category: 'medium' },
  { id: 'product',       name: 'Product',         messageCount: 350,  hasThreads: false, category: 'medium' },
  { id: 'standup',       name: 'Standup',         messageCount: 200,  hasThreads: false, category: 'medium' },
  { id: 'frontend',      name: 'Frontend',        messageCount: 600,  hasThreads: true,  category: 'medium' },
  { id: 'backend',       name: 'Backend',         messageCount: 450,  hasThreads: true,  category: 'medium' },

  // Large channels — slow scenarios (50-150ms)
  { id: 'support',       name: 'Support',         messageCount: 2000, hasThreads: true,  category: 'large' },
  { id: 'incidents',     name: 'Incidents',       messageCount: 1500, hasThreads: true,  category: 'large' },
  { id: 'design-review', name: 'Design Review',   messageCount: 3000, hasThreads: true,  category: 'large' },

  // Huge channels — outlier scenarios (150ms+)
  { id: 'all-hands',     name: 'All Hands',       messageCount: 5000, hasThreads: true,  category: 'huge' },
  { id: 'announcements', name: 'Announcements',   messageCount: 4000, hasThreads: true,  category: 'huge' },
  { id: 'firehose',      name: 'Firehose',        messageCount: 5000, hasThreads: false, category: 'huge' },
];
```

**Step 3: Commit**

```bash
git add demo-app/src/types.ts demo-app/src/channels.ts
git commit -m "feat: add demo app types and channel configuration"
```

---

### Task C3: Worker — generator and pipeline

**Files:**
- Create: `demo-app/src/worker/generator.ts`
- Create: `demo-app/src/worker/pipeline.ts`
- Create: `demo-app/src/worker/data-worker.ts`

These files contain the intentionally inefficient transform pipeline. The code is given verbatim in the spec under "Worker: Data Generation + Transform Pipeline" and "Transform Pipeline (Intentionally Inefficient)". Implement them exactly as specified — the inefficiencies are deliberate and will be revealed by the profiler.

**Step 1: Create generator.ts**

Implement exactly as specified in the plan section "worker/generator.ts". The full code is in the spec — copy it verbatim. Key points:
- 20 users in the USERS array
- `generateMessages()` creates `count` messages with thread replies (every 7th message in channels with threads)
- `generateMessageContent()` returns markdown with @mentions, :emoji:, URLs
- `generateReactions()` adds reactions to every 4th message

**Step 2: Create pipeline.ts**

Implement exactly as specified in the plan section "Transform Pipeline (Intentionally Inefficient)". This is the most important file — it contains 15 labeled inefficiencies. Copy it verbatim from the spec. Key functions:
- `transformPipeline()` — orchestrates 6 passes (inefficiency #2)
- `normalizeMessages()` — unnecessary map (inefficiency #3)
- `enrichMessages()` — no lookup cache (inefficiency #4)
- `resolveAuthor()` — array re-created + linear scan per call (inefficiency #5)
- `parseMarkdown()` — sequential regex (inefficiencies #6, #7)
- `extractMentions()` — indexOf dedupe O(n²) (inefficiency #8)
- `decodeEmojis()` — emoji map rebuilt per call (inefficiency #9)
- `formatTimestamp()` — Intl.DateTimeFormat per call (inefficiency #10)
- `getDateGroup()` — another DateTimeFormat per call (inefficiency #11)
- `sortMessages()` — Date→ISO→localeCompare (inefficiency #12)
- `groupByDate()` — reduce+spread O(n²) (inefficiency #13)
- `nestThreads()` — O(n²) filter inside map (inefficiency #14)
- `resolveReactions()` — resolveAuthor per reactor (inefficiency #15)

**Step 3: Create data-worker.ts**

```typescript
// src/worker/data-worker.ts
import { generateMessages } from './generator';
import { transformPipeline } from './pipeline';

self.onmessage = (event: MessageEvent) => {
  const { channelId, messageCount, hasThreads } = event.data;

  performance.mark('worker-process-start');

  const rawMessages = generateMessages(channelId, messageCount, hasThreads);
  const processed = transformPipeline(rawMessages, hasThreads);

  performance.mark('worker-process-end');

  self.postMessage({ channelId, messages: processed });
};
```

**Step 4: Commit**

```bash
git add demo-app/src/worker/
git commit -m "feat: add worker with generator and intentionally inefficient pipeline"
```

---

### Task C4: React components and hooks

**Files:**
- Create: `demo-app/src/main.tsx`
- Create: `demo-app/src/App.tsx`
- Create: `demo-app/src/hooks/useChannelData.ts`
- Create: `demo-app/src/components/ChannelList.tsx`
- Create: `demo-app/src/components/MessagePane.tsx`
- Create: `demo-app/src/components/Message.tsx`
- Create: `demo-app/src/components/StatusBar.tsx`

**Step 1: Create main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

**Step 2: Create useChannelData.ts**

Implement exactly as specified in the plan section "hooks/useChannelData.ts". Key points:
- Creates a single Web Worker instance
- `loadChannel()` fires `performance.mark('channel-switch-start')` at the start
- On worker response, fires `performance.mark('render-start')`, calls `renderMessages()`, fires `performance.mark('render-end')`, then `performance.mark('channel-switch-end')`
- `renderMessages()` is intentionally inefficient (inefficiency #16 — redundant template pre-computation)
- Creates `performance.measure('channel-switch-duration', ...)` and `performance.measure('render-duration', ...)`

**Step 3: Create App.tsx**

Implement as specified in the plan. Layout: sidebar (ChannelList) + main area (MessagePane) + footer (StatusBar).

**Step 4: Create ChannelList.tsx**

Implement as specified. Key: uses `role="tree"` and `role="treeitem"` with `aria-selected` for auto-labeling support.

**Step 5: Create MessagePane.tsx**

```tsx
import type { Channel, ProcessedMessage } from '../types';

interface Props {
  channel: Channel;
  messages: ProcessedMessage[];
  loading: boolean;
}

export function MessagePane({ channel, messages, loading }: Props) {
  if (loading) {
    return (
      <main className="message-pane">
        <div className="message-pane-header">
          <h2># {channel.name}</h2>
        </div>
        <div className="loading">Loading messages...</div>
      </main>
    );
  }

  return (
    <main className="message-pane">
      <div className="message-pane-header">
        <h2># {channel.name}</h2>
        <span className="message-count">{messages.length} messages</span>
      </div>
      <div className="message-list">
        {messages.map(msg => (
          <Message key={msg.id} message={msg} />
        ))}
      </div>
    </main>
  );
}

function Message({ message }: { message: ProcessedMessage }) {
  return (
    <div className="message">
      <div className="message-avatar">{message.author.avatar}</div>
      <div className="message-body">
        <div className="message-header">
          <span className="author-name">{message.author.name}</span>
          <span className="message-time">{message.formattedTime}</span>
        </div>
        <div
          className="message-content"
          dangerouslySetInnerHTML={{ __html: message.contentHtml }}
        />
        {message.reactionSummary.length > 0 && (
          <div className="reactions">
            {message.reactionSummary.map((r, i) => (
              <span key={i} className="reaction">
                {r.emoji} {r.count}
              </span>
            ))}
          </div>
        )}
        {message.threadMessages && message.threadMessages.length > 0 && (
          <div className="thread">
            <div className="thread-count">
              {message.threadMessages.length} replies
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 6: Create StatusBar.tsx**

```tsx
import type { Channel } from '../types';

interface Props {
  channel: Channel;
  duration: number | null;
  messageCount: number;
}

export function StatusBar({ channel, duration, messageCount }: Props) {
  return (
    <footer className="status-bar">
      <span>#{channel.name}</span>
      <span>{messageCount} messages</span>
      {duration !== null && (
        <span className="duration">
          Last switch: {duration.toFixed(1)}ms
        </span>
      )}
    </footer>
  );
}
```

**Step 7: Commit**

```bash
git add demo-app/src/
git commit -m "feat: add React components, hooks, and entry point"
```

---

### Task C5: Styles and build verification

**Files:**
- Create: `demo-app/src/styles.css`

**Step 1: Create styles.css**

Create a clean chat UI with sidebar + message pane layout. Dark theme. Key requirements:
- `.app` — flexbox row, full viewport height
- `.channel-list` — 240px sidebar, scrollable, dark background
- `.channel-list button` — full width, left-aligned, with active/selected state
- `.message-pane` — flex-grow, scrollable message list
- `.message` — flexbox row (avatar + body), with padding
- `.status-bar` — fixed footer bar showing last scenario duration
- `.loading` — centered spinner or text

Keep it functional — no animations, no fancy gradients. This is a profiling test fixture, not a production app.

**Step 2: Verify the app builds**

Run: `cd demo-app && npx vite build`
Expected: Build succeeds, outputs to `demo-app/dist/`

**Step 3: Commit**

```bash
git add demo-app/src/styles.css
git commit -m "feat: add demo app styles and verify build"
```

---

## Agent D: Profiler + Session (Wave 2)

> **Prerequisite**: All Wave 1 agents must be complete. This agent uses types, CDP layer, mark patcher, navigation handler, stats, and file output.

### Task D1: CPU profiler event handler

**Files:**
- Create: `chrome-function-profiler/src/profilers/cpu-profiler.ts`

The CPU profiler listens for `Profiler.consoleProfileStarted` and `Profiler.consoleProfileFinished` CDP events and delegates to callbacks.

**Step 1: Implement cpu-profiler.ts**

```typescript
// src/profilers/cpu-profiler.ts
import type CDP from 'chrome-remote-interface';
import type { Profile } from '../types.js';
import { enableProfiler, enableRuntime, evaluate, sendCommand } from '../cdp/session.js';
import { generateMarkPatch, generateRestorePatch, parseCaptureTitle, generateAutoLabelQuery } from '../instrumentation/mark-patcher.js';
import { NavigationHandler } from '../instrumentation/navigation-handler.js';

export interface CpuProfilerOptions {
  client: CDP.Client;
  sessionId?: string;
  startMark: string;
  endMark: string;
  samplingInterval?: number;
  maxCaptures?: number;
  onCaptureStart?: (captureIndex: number) => void;
  onCaptureEnd?: (captureIndex: number, profile: Profile, label: string, overlapCount: number) => void;
}

export class CpuProfiler {
  private client: CDP.Client;
  private sessionId?: string;
  private patchCode: string;
  private navigationHandler: NavigationHandler;
  private startHandler: ((event: any) => void) | null = null;
  private endHandler: ((event: any) => void) | null = null;
  private options: CpuProfilerOptions;
  private active = false;

  constructor(options: CpuProfilerOptions) {
    this.options = options;
    this.client = options.client;
    this.sessionId = options.sessionId;
    this.patchCode = generateMarkPatch(
      options.startMark,
      options.endMark,
      options.maxCaptures ?? 50
    );
    this.navigationHandler = new NavigationHandler({
      client: this.client,
      sessionId: this.sessionId,
      patchCode: this.patchCode,
    });
  }

  async start(): Promise<void> {
    this.active = true;

    // Enable profiler domain and set sampling interval
    await enableProfiler(
      this.client,
      this.options.samplingInterval ?? 200,
      this.sessionId
    );

    // Enable runtime for execution context events
    await enableRuntime(this.client, this.sessionId);

    // Inject the performance.mark patch
    await evaluate(this.client, this.patchCode, this.sessionId);

    // Start navigation handler for re-injection
    await this.navigationHandler.start();

    // Listen for profile start events
    this.startHandler = (event: any) => {
      if (!this.active) return;
      const { captureIndex } = parseCaptureTitle(event.title || '');
      this.navigationHandler.setCaptureInFlight(true);
      this.options.onCaptureStart?.(captureIndex);
    };
    this.client.on('Profiler.consoleProfileStarted' as any, this.startHandler);

    // Listen for profile end events
    this.endHandler = async (event: any) => {
      if (!this.active) return;
      this.navigationHandler.setCaptureInFlight(false);
      const { captureIndex, overlapCount } = parseCaptureTitle(event.title || '');
      const profile: Profile = event.profile;

      // Auto-label the capture
      let label = `invocation-${captureIndex}`;
      try {
        const autoLabel = await evaluate(
          this.client,
          generateAutoLabelQuery(),
          this.sessionId
        );
        if (autoLabel && typeof autoLabel === 'string') {
          label = autoLabel;
        }
      } catch {
        // Auto-label failed — use default
      }

      this.options.onCaptureEnd?.(captureIndex, profile, label, overlapCount);
    };
    this.client.on('Profiler.consoleProfileFinished' as any, this.endHandler);
  }

  async stop(): Promise<void> {
    this.active = false;
    this.navigationHandler.stop();

    // Remove event listeners
    if (this.startHandler) {
      this.client.removeListener('Profiler.consoleProfileStarted' as any, this.startHandler);
      this.startHandler = null;
    }
    if (this.endHandler) {
      this.client.removeListener('Profiler.consoleProfileFinished' as any, this.endHandler);
      this.endHandler = null;
    }

    // Restore original performance.mark
    try {
      await evaluate(this.client, generateRestorePatch(), this.sessionId);
    } catch {
      // Page may have navigated — patch already gone
    }
  }
}
```

**Step 2: Verify compilation**

Run: `cd chrome-function-profiler && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add chrome-function-profiler/src/profilers/cpu-profiler.ts
git commit -m "feat: add CPU profiler with event handling and auto-labeling"
```

---

### Task D2: Profiling session manager

**Files:**
- Create: `chrome-function-profiler/src/session/profiling-session.ts`

The profiling session orchestrates multi-capture workflows. It uses the CpuProfiler to capture profiles, accumulates them, and generates summaries on stop.

**Step 1: Implement profiling-session.ts**

```typescript
// src/session/profiling-session.ts
import type CDP from 'chrome-remote-interface';
import type { CaptureInfo, Profile, SessionState, SessionSummary, StatsResult } from '../types.js';
import { CpuProfiler } from '../profilers/cpu-profiler.js';
import { WorkerManager } from '../cdp/worker-manager.js';
import { computeStats, detectOutliers } from '../utils/stats.js';
import { saveProfile, saveSummary } from '../utils/file-output.js';
import { profileDurationMs } from '../analysis/profile-parser.js';
import { join } from 'node:path';

export interface ProfilingSessionOptions {
  client: CDP.Client;
  workerManager: WorkerManager;
  startMark: string;
  endMark: string;
  target?: 'main' | 'worker';
  workerUrl?: string;
  samplingInterval?: number;
  maxCaptures?: number;
  outputDir?: string;
  sessionTimeoutMs?: number;
}

export class ProfilingSession {
  private options: ProfilingSessionOptions;
  private profiler: CpuProfiler | null = null;
  private state: SessionState;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private onTimeout?: () => void;

  constructor(options: ProfilingSessionOptions) {
    this.options = options;
    this.state = {
      id: `sess_${Date.now()}`,
      startMark: options.startMark,
      endMark: options.endMark,
      target: options.target ?? 'main',
      workerUrl: options.workerUrl,
      captures: [],
      captureIndex: 0,
      active: false,
      startedAt: Date.now(),
    };
  }

  getState(): SessionState {
    return this.state;
  }

  setOnTimeout(handler: () => void): void {
    this.onTimeout = handler;
  }

  async start(): Promise<string> {
    // Resolve target session
    let sessionId: string | undefined;
    if (this.state.target === 'worker') {
      sessionId = this.options.workerManager.getSessionId(this.state.workerUrl);
    }

    const outputDir = this.options.outputDir ?? './profiles/session';

    this.profiler = new CpuProfiler({
      client: this.options.client,
      sessionId,
      startMark: this.state.startMark,
      endMark: this.state.endMark,
      samplingInterval: this.options.samplingInterval ?? 200,
      maxCaptures: this.options.maxCaptures ?? 50,
      onCaptureStart: (idx) => {
        this.state.captureIndex = idx;
      },
      onCaptureEnd: async (idx, profile, label, overlapCount) => {
        const duration = profileDurationMs(profile);
        const filename = `invocation-${idx}.cpuprofile`;

        // Save the profile
        await saveProfile(profile, join(outputDir, filename));

        const capture: CaptureInfo = {
          index: idx,
          label,
          duration,
          overlappingInvocations: overlapCount,
          profile,
          files: { cpu: filename },
        };
        this.state.captures.push(capture);
      },
    });

    await this.profiler.start();
    this.state.active = true;

    // Session timeout
    const timeout = this.options.sessionTimeoutMs ?? 300000;
    this.timeoutTimer = setTimeout(() => {
      this.onTimeout?.();
    }, timeout);

    return this.state.id;
  }

  async stop(): Promise<SessionSummary> {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    if (this.profiler) {
      await this.profiler.stop();
      this.profiler = null;
    }

    this.state.active = false;

    // Generate summary
    const summary = this.generateSummary();
    const outputDir = this.options.outputDir ?? './profiles/session';
    await saveSummary(summary, outputDir);

    return summary;
  }

  private generateSummary(): SessionSummary {
    const captures = this.state.captures;
    const durations = captures.map(c => c.duration);

    let stats: { cpu: StatsResult } = {
      cpu: { min: 0, max: 0, avg: 0, p50: 0, p95: 0, stddev: 0 },
    };

    if (durations.length > 0) {
      stats = { cpu: computeStats(durations) };
    }

    const outlierItems = captures.map(c => ({
      label: c.label,
      value: c.duration,
    }));
    const outliers = durations.length >= 3
      ? detectOutliers(outlierItems, 2).map(o => ({
          label: o.label,
          metric: 'cpu.duration',
          value: o.value,
          zscore: o.zscore,
        }))
      : [];

    return {
      sessionId: this.state.id,
      startMark: this.state.startMark,
      endMark: this.state.endMark,
      totalCaptures: captures.length,
      captures: captures.map(c => ({
        index: c.index,
        label: c.label,
        duration: c.duration,
        overlappingInvocations: c.overlappingInvocations,
        files: c.files,
      })),
      stats,
      outliers,
    };
  }
}
```

**Step 2: Verify compilation**

Run: `cd chrome-function-profiler && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add chrome-function-profiler/src/session/
git commit -m "feat: add profiling session manager with capture accumulation and summary"
```

---

## Agent E: MCP Server (Wave 3)

> **Prerequisite**: All Wave 2 tasks must be complete.

### Task E1: MCP server entry point with all tools

**Files:**
- Create: `chrome-function-profiler/src/index.ts`

Wire everything into the MCP server using `@modelcontextprotocol/sdk`. Register all Phase 1 tools: `connect`, `disconnect`, `list_targets`, `profile_scenario`, `start_profiling_session`, `stop_profiling_session`, `compare_profiles`.

**Step 1: Implement index.ts**

```typescript
// src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createConnection, listCDPTargets, type CDPConnection } from './cdp/connection.js';
import { WorkerManager } from './cdp/worker-manager.js';
import { ProfilingSession } from './session/profiling-session.js';
import { compareProfiles } from './analysis/profile-comparator.js';
import { loadProfile } from './utils/file-output.js';
import { topFunctions, profileDurationMs } from './analysis/profile-parser.js';

// State
let connection: CDPConnection | null = null;
let workerManager: WorkerManager | null = null;
let activeSession: ProfilingSession | null = null;

const server = new McpServer({
  name: 'chrome-function-profiler',
  version: '0.1.0',
});

// --- Tool: connect ---
server.tool(
  'connect',
  'Connect to a Chrome instance debug port. Chrome must be running with --remote-debugging-port.',
  {
    port: z.number().default(9222).describe('Chrome remote debugging port'),
    host: z.string().default('127.0.0.1').describe('Chrome host'),
  },
  async ({ port, host }) => {
    if (connection) {
      return { content: [{ type: 'text', text: 'Already connected. Call disconnect first.' }] };
    }

    try {
      connection = await createConnection({ port, host });
      workerManager = new WorkerManager(connection.client);
      await workerManager.start();

      const targets = await listCDPTargets({ port, host });
      const workers = workerManager.getWorkers();

      const lines = [
        `Connected to Chrome at ${host}:${port}`,
        '',
        'Page targets:',
        ...targets
          .filter(t => t.type === 'page')
          .map(t => `  - ${t.title} (${t.url})`),
        '',
        `Workers discovered: ${workers.length}`,
        ...workers.map(w => `  - ${w.type}: ${w.url}`),
      ];

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err: any) {
      return {
        content: [{
          type: 'text',
          text: `Failed to connect: ${err.message}\n\nMake sure Chrome is running with --remote-debugging-port=${port}`,
        }],
        isError: true,
      };
    }
  }
);

// --- Tool: disconnect ---
server.tool(
  'disconnect',
  'Disconnect from Chrome and clean up all active profiling sessions.',
  {},
  async () => {
    if (activeSession) {
      try { await activeSession.stop(); } catch {}
      activeSession = null;
    }
    if (connection) {
      workerManager?.clear();
      workerManager = null;
      await connection.close();
      connection = null;
    }
    return { content: [{ type: 'text', text: 'Disconnected.' }] };
  }
);

// --- Tool: list_targets ---
server.tool(
  'list_targets',
  'List all available profiling targets (main thread, workers).',
  {},
  async () => {
    if (!connection || !workerManager) {
      return { content: [{ type: 'text', text: 'Not connected. Call connect first.' }], isError: true };
    }

    const targets = await listCDPTargets({ port: connection.port, host: connection.host });
    const workers = workerManager.getWorkers();

    const lines = [
      'Available targets:',
      '',
      'Main thread:',
      ...targets.filter(t => t.type === 'page').map(t => `  - ${t.title} (${t.url})`),
      '',
      `Workers (${workers.length}):`,
      ...workers.map((w, i) => `  ${i + 1}. [${w.type}] ${w.url} (session: ${w.sessionId.slice(0, 8)}...)`),
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// --- Tool: profile_scenario ---
server.tool(
  'profile_scenario',
  'Profile CPU execution of a single scenario defined by performance.mark pairs. Arms the profiler and waits for the start mark to fire.',
  {
    startMark: z.string().describe('Name of the performance.mark() at scenario entry'),
    endMark: z.string().describe('Name of the performance.mark() at scenario exit'),
    target: z.enum(['main', 'worker']).default('main').describe('Which thread to profile'),
    workerUrl: z.string().optional().describe('Partial URL to identify the worker'),
    samplingInterval: z.number().default(200).describe('CPU sampling interval in microseconds'),
    output: z.string().default('./profiles/profile.cpuprofile').describe('Output file path'),
    timeoutMs: z.number().default(30000).describe('Max time to wait for scenario'),
  },
  async ({ startMark, endMark, target, workerUrl, samplingInterval, output, timeoutMs }) => {
    if (!connection || !workerManager) {
      return { content: [{ type: 'text', text: 'Not connected. Call connect first.' }], isError: true };
    }

    const session = new ProfilingSession({
      client: connection.client,
      workerManager,
      startMark,
      endMark,
      target,
      workerUrl,
      samplingInterval,
      maxCaptures: 1,
      outputDir: output.replace(/\/[^/]+$/, ''),
      sessionTimeoutMs: timeoutMs,
    });

    // Wait for one capture or timeout
    return new Promise(async (resolve) => {
      let resolved = false;

      session.setOnTimeout(() => {
        if (!resolved) {
          resolved = true;
          session.stop().then(() => {
            resolve({
              content: [{
                type: 'text',
                text: `Timeout: No scenario captured within ${timeoutMs}ms. The marks '${startMark}'/'${endMark}' may not have fired. Verify the mark names and trigger the scenario.`,
              }],
              isError: true,
            });
          });
        }
      });

      await session.start();

      // Poll for capture completion
      const checkInterval = setInterval(async () => {
        const state = session.getState();
        if (state.captures.length >= 1 && !resolved) {
          resolved = true;
          clearInterval(checkInterval);
          const summary = await session.stop();
          const capture = summary.captures[0];
          const lines = [
            `Captured scenario: ${capture.label}`,
            `Duration: ${capture.duration.toFixed(1)}ms`,
            capture.overlappingInvocations > 1
              ? `Note: ${capture.overlappingInvocations} overlapping invocations (merged profile)`
              : '',
            `Saved to: ${capture.files.cpu}`,
          ].filter(Boolean);
          resolve({ content: [{ type: 'text', text: lines.join('\n') }] });
        }
      }, 100);
    });
  }
);

// --- Tool: start_profiling_session ---
server.tool(
  'start_profiling_session',
  'Start a multi-capture profiling session. Captures a profile every time the scenario fires between the given marks. Call stop_profiling_session when done.',
  {
    startMark: z.string().describe('Name of the performance.mark() at scenario entry'),
    endMark: z.string().describe('Name of the performance.mark() at scenario exit'),
    target: z.enum(['main', 'worker']).default('main'),
    workerUrl: z.string().optional(),
    samplingInterval: z.number().default(200),
    outputDir: z.string().default('./profiles/session'),
    maxCaptures: z.number().default(50),
    sessionTimeoutMs: z.number().default(300000),
  },
  async ({ startMark, endMark, target, workerUrl, samplingInterval, outputDir, maxCaptures, sessionTimeoutMs }) => {
    if (!connection || !workerManager) {
      return { content: [{ type: 'text', text: 'Not connected. Call connect first.' }], isError: true };
    }

    if (activeSession) {
      return { content: [{ type: 'text', text: 'A session is already active. Call stop_profiling_session first.' }], isError: true };
    }

    activeSession = new ProfilingSession({
      client: connection.client,
      workerManager,
      startMark,
      endMark,
      target,
      workerUrl,
      samplingInterval,
      maxCaptures,
      outputDir,
      sessionTimeoutMs,
    });

    activeSession.setOnTimeout(async () => {
      if (activeSession) {
        await activeSession.stop();
        activeSession = null;
      }
    });

    const sessionId = await activeSession.start();

    return {
      content: [{
        type: 'text',
        text: [
          `Session started (${sessionId}).`,
          `Profiling every scenario between '${startMark}' and '${endMark}'.`,
          `Target: ${target}${workerUrl ? ` (worker: ${workerUrl})` : ''}`,
          `Sampling interval: ${samplingInterval}μs`,
          '',
          'Interact with the app normally. Tell me when you\'re done.',
        ].join('\n'),
      }],
    };
  }
);

// --- Tool: stop_profiling_session ---
server.tool(
  'stop_profiling_session',
  'Stop the active profiling session and generate a summary.',
  {},
  async () => {
    if (!activeSession) {
      return { content: [{ type: 'text', text: 'No active session.' }], isError: true };
    }

    const summary = await activeSession.stop();
    activeSession = null;

    if (summary.totalCaptures === 0) {
      return {
        content: [{
          type: 'text',
          text: `Session stopped. No scenarios were captured. The marks '${summary.startMark}'/'${summary.endMark}' may not have fired.`,
        }],
      };
    }

    const lines = [
      `Session stopped. Captured ${summary.totalCaptures} invocations.`,
      '',
      '| # | Label | Duration | Notes |',
      '|---|-------|----------|-------|',
      ...summary.captures.map(c => {
        const notes: string[] = [];
        const outlier = summary.outliers.find(o => o.label === c.label);
        if (outlier) notes.push(`outlier (${outlier.zscore.toFixed(1)}σ)`);
        if (c.overlappingInvocations > 1) notes.push(`${c.overlappingInvocations} overlapping`);
        return `| ${c.index} | ${c.label} | ${c.duration.toFixed(1)}ms | ${notes.join(', ')} |`;
      }),
      '',
      `Stats: min=${summary.stats.cpu.min.toFixed(1)}ms, max=${summary.stats.cpu.max.toFixed(1)}ms, avg=${summary.stats.cpu.avg.toFixed(1)}ms, p50=${summary.stats.cpu.p50.toFixed(1)}ms, p95=${summary.stats.cpu.p95.toFixed(1)}ms`,
      '',
      `Profiles saved to: ${summary.captures[0]?.files.cpu ? summary.captures[0].files.cpu.replace(/\/[^/]+$/, '') : 'profiles/session/'}`,
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// --- Tool: compare_profiles ---
server.tool(
  'compare_profiles',
  'Compare two CPU profiles to find which functions got hotter/colder.',
  {
    profileA: z.string().describe('Path to the baseline/fast profile'),
    profileB: z.string().describe('Path to the regression/slow profile'),
    topN: z.number().default(20).describe('Number of top differences'),
  },
  async ({ profileA, profileB, topN }) => {
    try {
      const a = await loadProfile(profileA);
      const b = await loadProfile(profileB);

      const diffs = compareProfiles(a, b, topN);
      const durationA = profileDurationMs(a);
      const durationB = profileDurationMs(b);

      const lines = [
        `Profile A: ${profileA} (${durationA.toFixed(1)}ms)`,
        `Profile B: ${profileB} (${durationB.toFixed(1)}ms)`,
        '',
        `Top ${Math.min(topN, diffs.length)} differences:`,
        '',
        '| Function | File | Line | A (hits) | B (hits) | Delta |',
        '|----------|------|------|----------|----------|-------|',
        ...diffs.map(d =>
          `| ${d.functionName} | ${d.url.split('/').pop() || d.url} | ${d.lineNumber} | ${d.hitsA} | ${d.hitsB} | ${d.delta > 0 ? '+' : ''}${d.delta} |`
        ),
      ];

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Build the project**

Run: `cd chrome-function-profiler && npx tsc`
Expected: Compiles successfully to `build/`

**Step 3: Commit**

```bash
git add chrome-function-profiler/src/index.ts
git commit -m "feat: add MCP server with all Phase 1 tools"
```

---

### Task E2: MCP config and build verification

**Files:**
- Create: `chrome-function-profiler/.mcp.json`
- Verify: full build and tool listing

**Step 1: Create .mcp.json example**

```json
{
  "mcpServers": {
    "chrome-profiler": {
      "command": "node",
      "args": ["./chrome-function-profiler/build/index.js"]
    }
  }
}
```

**Step 2: Full build**

Run: `cd chrome-function-profiler && npm run build`
Expected: Builds to `build/` with no errors

**Step 3: Run all tests**

Run: `cd chrome-function-profiler && npx vitest run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add chrome-function-profiler/.mcp.json
git commit -m "feat: add MCP config example and verify full build"
```

---

## Post-Implementation Checklist

After all agents complete:

1. **Build both projects**: `cd chrome-function-profiler && npm run build` and `cd demo-app && npm run build`
2. **Run all MCP server tests**: `cd chrome-function-profiler && npx vitest run`
3. **Verify demo app serves**: `cd demo-app && npx vite --host` (check http://localhost:5173)
4. **Integration test** (manual):
   - Launch Chrome with `--remote-debugging-port=9222`
   - Open http://localhost:5173 in Chrome
   - Start the MCP server
   - Call `connect`
   - Call `start_profiling_session` with `startMark: "channel-switch-start"`, `endMark: "channel-switch-end"`
   - Click through channels in the demo app
   - Call `stop_profiling_session`
   - Verify .cpuprofile files are valid and loadable in DevTools
   - Call `compare_profiles` with fastest vs slowest

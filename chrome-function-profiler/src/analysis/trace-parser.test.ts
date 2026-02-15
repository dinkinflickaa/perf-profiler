import { describe, it, expect } from 'vitest';
import { findMarks, extractDuration, extractCpuProfiles } from './trace-parser.js';
import type { TraceEvent } from '../types.js';

describe('findMarks', () => {
  it('filters blink.user_timing events by name', () => {
    const events: TraceEvent[] = [
      { pid: 1, tid: 1, ts: 1000, ph: 'R', cat: 'blink.user_timing', name: 'startWork' },
      { pid: 1, tid: 1, ts: 2000, ph: 'R', cat: 'blink.user_timing', name: 'endWork' },
      { pid: 1, tid: 1, ts: 3000, ph: 'X', cat: 'devtools.timeline', name: 'startWork' },
    ];
    const marks = findMarks(events, 'startWork');
    expect(marks).toHaveLength(1);
    expect(marks[0].ts).toBe(1000);
  });

  it('returns empty array when no matches', () => {
    const events: TraceEvent[] = [
      { pid: 1, tid: 1, ts: 1000, ph: 'R', cat: 'devtools.timeline', name: 'foo' },
    ];
    expect(findMarks(events, 'bar')).toHaveLength(0);
  });
});

describe('extractDuration', () => {
  it('computes duration between start and end marks in ms', () => {
    const events: TraceEvent[] = [
      { pid: 1, tid: 1, ts: 10000, ph: 'R', cat: 'blink.user_timing', name: 'start' },
      { pid: 1, tid: 1, ts: 60000, ph: 'R', cat: 'blink.user_timing', name: 'end' },
    ];
    expect(extractDuration(events, 'start', 'end')).toBe(50); // 50000us = 50ms
  });

  it('returns 0 when no start mark found', () => {
    const events: TraceEvent[] = [
      { pid: 1, tid: 1, ts: 60000, ph: 'R', cat: 'blink.user_timing', name: 'end' },
    ];
    expect(extractDuration(events, 'start', 'end')).toBe(0);
  });

  it('returns 0 when no end mark found', () => {
    const events: TraceEvent[] = [
      { pid: 1, tid: 1, ts: 10000, ph: 'R', cat: 'blink.user_timing', name: 'start' },
    ];
    expect(extractDuration(events, 'start', 'end')).toBe(0);
  });

  it('uses earliest start and first end after it', () => {
    const events: TraceEvent[] = [
      { pid: 1, tid: 1, ts: 20000, ph: 'R', cat: 'blink.user_timing', name: 'start' },
      { pid: 1, tid: 1, ts: 10000, ph: 'R', cat: 'blink.user_timing', name: 'start' },
      { pid: 1, tid: 1, ts: 30000, ph: 'R', cat: 'blink.user_timing', name: 'end' },
      { pid: 1, tid: 1, ts: 50000, ph: 'R', cat: 'blink.user_timing', name: 'end' },
    ];
    // Earliest start = 10000, first end after that = 30000
    expect(extractDuration(events, 'start', 'end')).toBe(20);
  });
});

describe('extractCpuProfiles', () => {
  it('extracts profiles from ProfileChunk events', () => {
    const events: TraceEvent[] = [
      {
        pid: 1, tid: 10, ts: 1000, ph: 'P', cat: 'disabled-by-default-v8.cpu_profiler',
        name: 'Profile',
        args: { data: { startTime: 1000 } },
      },
      {
        pid: 1, tid: 10, ts: 2000, ph: 'P', cat: 'disabled-by-default-v8.cpu_profiler',
        name: 'ProfileChunk',
        args: {
          data: {
            cpuProfile: {
              nodes: [
                { id: 1, callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: 0, columnNumber: 0 }, children: [2] },
                { id: 2, callFrame: { functionName: 'doWork', scriptId: '1', url: 'app.js', lineNumber: 10, columnNumber: 0 }, hitCount: 0 },
              ],
              samples: [2, 2, 2, 1],
            },
            timeDeltas: [100, 100, 100, 100],
          },
        },
      },
    ];

    const profiles = extractCpuProfiles(events);
    expect(profiles.size).toBe(1);

    const profile = profiles.get(10)!;
    expect(profile.nodes).toHaveLength(2);
    expect(profile.samples).toEqual([2, 2, 2, 1]);
    expect(profile.timeDeltas).toEqual([100, 100, 100, 100]);

    // doWork (id=2) should have hitCount=3 from samples
    const doWork = profile.nodes.find(n => n.callFrame.functionName === 'doWork');
    expect(doWork?.hitCount).toBe(3);
  });

  it('merges multiple ProfileChunk events for same thread', () => {
    const events: TraceEvent[] = [
      {
        pid: 1, tid: 5, ts: 1000, ph: 'P', cat: 'disabled-by-default-v8.cpu_profiler',
        name: 'Profile',
        args: { data: { startTime: 1000 } },
      },
      {
        pid: 1, tid: 5, ts: 2000, ph: 'P', cat: 'disabled-by-default-v8.cpu_profiler',
        name: 'ProfileChunk',
        args: {
          data: {
            cpuProfile: {
              nodes: [
                { id: 1, callFrame: { functionName: 'a', scriptId: '1', url: 'a.js', lineNumber: 1, columnNumber: 0 } },
              ],
              samples: [1, 1],
            },
            timeDeltas: [50, 50],
          },
        },
      },
      {
        pid: 1, tid: 5, ts: 3000, ph: 'P', cat: 'disabled-by-default-v8.cpu_profiler',
        name: 'ProfileChunk',
        args: {
          data: {
            cpuProfile: {
              nodes: [
                { id: 2, callFrame: { functionName: 'b', scriptId: '2', url: 'b.js', lineNumber: 2, columnNumber: 0 } },
              ],
              samples: [2, 2, 2],
            },
            timeDeltas: [50, 50, 50],
          },
        },
      },
    ];

    const profiles = extractCpuProfiles(events);
    expect(profiles.size).toBe(1);

    const profile = profiles.get(5)!;
    expect(profile.nodes).toHaveLength(2);
    expect(profile.samples).toEqual([1, 1, 2, 2, 2]);
    expect(profile.timeDeltas).toEqual([50, 50, 50, 50, 50]);
  });

  it('returns empty map for no profiler events', () => {
    const events: TraceEvent[] = [
      { pid: 1, tid: 1, ts: 1000, ph: 'X', cat: 'devtools.timeline', name: 'Paint' },
    ];
    expect(extractCpuProfiles(events).size).toBe(0);
  });

  it('handles multiple threads', () => {
    const events: TraceEvent[] = [
      {
        pid: 1, tid: 10, ts: 1000, ph: 'P', cat: 'disabled-by-default-v8.cpu_profiler',
        name: 'Profile', args: { data: { startTime: 1000 } },
      },
      {
        pid: 1, tid: 20, ts: 1000, ph: 'P', cat: 'disabled-by-default-v8.cpu_profiler',
        name: 'Profile', args: { data: { startTime: 1000 } },
      },
      {
        pid: 1, tid: 10, ts: 2000, ph: 'P', cat: 'disabled-by-default-v8.cpu_profiler',
        name: 'ProfileChunk',
        args: {
          data: {
            cpuProfile: {
              nodes: [{ id: 1, callFrame: { functionName: 'mainFn', scriptId: '1', url: 'main.js', lineNumber: 1, columnNumber: 0 } }],
              samples: [1],
            },
            timeDeltas: [100],
          },
        },
      },
      {
        pid: 1, tid: 20, ts: 2000, ph: 'P', cat: 'disabled-by-default-v8.cpu_profiler',
        name: 'ProfileChunk',
        args: {
          data: {
            cpuProfile: {
              nodes: [{ id: 1, callFrame: { functionName: 'workerFn', scriptId: '2', url: 'worker.js', lineNumber: 1, columnNumber: 0 } }],
              samples: [1, 1],
            },
            timeDeltas: [100, 100],
          },
        },
      },
    ];

    const profiles = extractCpuProfiles(events);
    expect(profiles.size).toBe(2);
    expect(profiles.get(10)!.nodes[0].callFrame.functionName).toBe('mainFn');
    expect(profiles.get(20)!.nodes[0].callFrame.functionName).toBe('workerFn');
  });
});

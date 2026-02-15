import type { TraceEvent, Profile, ProfileNode } from '../types.js';

/**
 * Find user timing marks matching a given name in trace events.
 */
export function findMarks(events: TraceEvent[], markName: string): TraceEvent[] {
  return events.filter(
    e => e.cat === 'blink.user_timing' && e.name === markName
  );
}

/**
 * Extract duration in milliseconds between start and end marks.
 * Uses the first matching start mark and the first matching end mark after it.
 */
export function extractDuration(
  events: TraceEvent[],
  startMark: string,
  endMark: string
): number {
  const startEvents = findMarks(events, startMark);
  const endEvents = findMarks(events, endMark);

  if (startEvents.length === 0 || endEvents.length === 0) return 0;

  // Find earliest start
  const start = startEvents.reduce((a, b) => a.ts < b.ts ? a : b);
  // Find earliest end after start
  const end = endEvents.find(e => e.ts >= start.ts);
  if (!end) return 0;

  return (end.ts - start.ts) / 1000; // microseconds -> milliseconds
}

/**
 * Extract CPU profiles from ProfileChunk trace events.
 * Returns a Map of threadId -> Profile.
 *
 * ProfileChunk events have:
 *   cat: "disabled-by-default-v8.cpu_profiler"
 *   name: "ProfileChunk" or "Profile"
 *   args.data.cpuProfile: { nodes, startTime, endTime, samples, timeDeltas }
 */
export function extractCpuProfiles(events: TraceEvent[]): Map<number, Profile> {
  const profiles = new Map<number, {
    nodes: Map<number, ProfileNode>;
    startTime: number;
    endTime: number;
    samples: number[];
    timeDeltas: number[];
  }>();

  // First pass: collect Profile events (these initialize the profile with nodes)
  for (const event of events) {
    if (event.cat !== 'disabled-by-default-v8.cpu_profiler') continue;

    if (event.name === 'Profile') {
      const tid = event.tid;
      if (!profiles.has(tid)) {
        profiles.set(tid, {
          nodes: new Map(),
          startTime: event.args?.data?.startTime ?? event.ts,
          endTime: event.ts,
          samples: [],
          timeDeltas: [],
        });
      }
    }
  }

  // Second pass: collect ProfileChunk events
  for (const event of events) {
    if (event.cat !== 'disabled-by-default-v8.cpu_profiler') continue;
    if (event.name !== 'ProfileChunk') continue;

    const tid = event.tid;
    const cpuProfile = event.args?.data?.cpuProfile;
    if (!cpuProfile) continue;

    if (!profiles.has(tid)) {
      profiles.set(tid, {
        nodes: new Map(),
        startTime: cpuProfile.startTime ?? event.ts,
        endTime: event.ts,
        samples: [],
        timeDeltas: [],
      });
    }

    const prof = profiles.get(tid)!;

    // Merge nodes
    if (cpuProfile.nodes) {
      for (const node of cpuProfile.nodes) {
        if (!prof.nodes.has(node.id)) {
          prof.nodes.set(node.id, {
            id: node.id,
            callFrame: node.callFrame,
            hitCount: node.hitCount ?? 0,
            children: node.children ?? [],
          });
        }
      }
    }

    // Append samples and timeDeltas
    if (cpuProfile.samples) {
      prof.samples.push(...cpuProfile.samples);
    }
    const timeDeltas = event.args?.data?.timeDeltas ?? cpuProfile.timeDeltas;
    if (timeDeltas) {
      prof.timeDeltas.push(...timeDeltas);
    }

    prof.endTime = Math.max(prof.endTime, event.ts);
  }

  // Convert to Profile format and compute hit counts from samples
  const result = new Map<number, Profile>();

  for (const [tid, prof] of profiles) {
    if (prof.nodes.size === 0) continue;

    // Compute hit counts from samples
    const hitCounts = new Map<number, number>();
    for (const sampleId of prof.samples) {
      hitCounts.set(sampleId, (hitCounts.get(sampleId) ?? 0) + 1);
    }

    const nodes: ProfileNode[] = [];
    for (const node of prof.nodes.values()) {
      nodes.push({
        ...node,
        hitCount: hitCounts.get(node.id) ?? node.hitCount ?? 0,
      });
    }

    result.set(tid, {
      nodes,
      startTime: prof.startTime,
      endTime: prof.endTime,
      samples: prof.samples,
      timeDeltas: prof.timeDeltas,
    });
  }

  return result;
}

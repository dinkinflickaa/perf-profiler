import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Profile, SessionSummary, TraceEvent } from '../types.js';
import { extractCpuProfiles, extractThreadNames } from '../analysis/trace-parser.js';

export async function saveProfile(profile: Profile, filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
}

export async function saveSummary(summary: SessionSummary, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
}

export async function saveTrace(events: TraceEvent[], filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(events, null, 2), 'utf-8');
}

export async function loadProfile(filePath: string): Promise<Profile> {
  const data = await readFile(filePath, 'utf-8');
  return JSON.parse(data) as Profile;
}

/** Internal threads that should be excluded from user-facing profile selection. */
const INTERNAL_THREAD_PATTERNS = ['v8:ProfEvntProc', 'v8:Profiler'];

export async function loadProfileFromTrace(filePath: string, threadFilter?: string): Promise<Profile> {
  const data = await readFile(filePath, 'utf-8');
  const events = JSON.parse(data) as TraceEvent[];

  const profiles = extractCpuProfiles(events);
  const threadNames = extractThreadNames(events);

  // Filter out internal V8 profiler threads
  const meaningful = new Map<number, Profile>();
  for (const [tid, profile] of profiles) {
    const name = threadNames.get(tid) ?? `thread-${tid}`;
    const isInternal = INTERNAL_THREAD_PATTERNS.some(p => name.includes(p));
    if (!isInternal) {
      meaningful.set(tid, profile);
    }
  }

  if (meaningful.size === 0) {
    throw new Error('No CPU profiles found in trace file.');
  }

  if (threadFilter) {
    const lowerFilter = threadFilter.toLowerCase();
    const matches: Array<[number, Profile]> = [];
    for (const [tid, profile] of meaningful) {
      const name = threadNames.get(tid) ?? `thread-${tid}`;
      if (name.toLowerCase().includes(lowerFilter)) {
        matches.push([tid, profile]);
      }
    }
    if (matches.length === 0) {
      const available = [...meaningful.keys()]
        .map(tid => `  - ${threadNames.get(tid) ?? `thread-${tid}`}`)
        .join('\n');
      throw new Error(`No thread matching "${threadFilter}". Available threads:\n${available}`);
    }
    return matches[0][1];
  }

  if (meaningful.size === 1) {
    return meaningful.values().next().value!;
  }

  const available = [...meaningful.keys()]
    .map(tid => `  - ${threadNames.get(tid) ?? `thread-${tid}`}`)
    .join('\n');
  throw new Error(`Multiple threads found. Specify a thread filter:\n${available}`);
}

export async function loadProfileAuto(filePath: string, threadFilter?: string): Promise<Profile> {
  if (filePath.endsWith('.trace.json')) {
    return loadProfileFromTrace(filePath, threadFilter);
  }
  return loadProfile(filePath);
}

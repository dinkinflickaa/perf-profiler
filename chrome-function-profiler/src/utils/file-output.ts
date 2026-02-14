import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Profile, SessionSummary } from '../types.js';

export async function saveProfile(profile: Profile, filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
}

export async function saveSummary(summary: SessionSummary, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
}

export async function loadProfile(filePath: string): Promise<Profile> {
  const data = await readFile(filePath, 'utf-8');
  return JSON.parse(data) as Profile;
}

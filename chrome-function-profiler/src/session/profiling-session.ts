import type CDP from 'chrome-remote-interface';
import type { CaptureInfo, Profile, SessionState, SessionSummary, StatsResult, TraceEvent } from '../types.js';
import { CpuProfiler } from '../profilers/cpu-profiler.js';
import { TracingProfiler } from '../profilers/trace-profiler.js';
import { WorkerManager } from '../cdp/worker-manager.js';
import { computeStats, detectOutliers } from '../utils/stats.js';
import { saveProfile, saveSummary, saveTrace } from '../utils/file-output.js';
import { profileDurationMs } from '../analysis/profile-parser.js';
import { join } from 'node:path';

export interface ProfilingSessionOptions {
  client: CDP.Client;
  workerManager: WorkerManager;
  startMark: string;
  endMark: string;
  target?: 'main' | 'worker' | 'full';
  workerUrl?: string;
  samplingInterval?: number;
  maxCaptures?: number;
  outputDir?: string;
  sessionTimeoutMs?: number;
}

export class ProfilingSession {
  private options: ProfilingSessionOptions;
  private profiler: CpuProfiler | TracingProfiler | null = null;
  private state: SessionState;
  private outputDir: string;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private onTimeout?: () => void;

  constructor(options: ProfilingSessionOptions) {
    this.options = options;
    const scenarioName = options.startMark.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.outputDir = options.outputDir ?? `./profiles/${scenarioName}`;
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
    const outputDir = this.outputDir;

    if (this.state.target === 'full') {
      this.profiler = new TracingProfiler({
        client: this.options.client,
        workerManager: this.options.workerManager,
        startMark: this.state.startMark,
        endMark: this.state.endMark,
        maxCaptures: this.options.maxCaptures ?? 50,
        onCaptureStart: (idx) => {
          this.state.captureIndex = idx;
        },
        onCaptureEnd: async (idx, traceEvents, duration, cpuProfiles, label, overlapCount) => {
          const traceFilename = `invocation-${idx}.trace.json`;
          await saveTrace(traceEvents, join(outputDir, traceFilename));

          const files: CaptureInfo['files'] = { trace: traceFilename };

          // Extract and save per-thread CPU profiles
          const threads = [...cpuProfiles.entries()];
          if (threads.length > 0) {
            // Save first thread as the main cpu profile
            const [, mainProfile] = threads[0];
            const cpuFilename = `invocation-${idx}.cpuprofile`;
            await saveProfile(mainProfile, join(outputDir, cpuFilename));
            files.cpu = cpuFilename;

            // Save additional threads as worker cpu profiles
            if (threads.length > 1) {
              const [, workerProfile] = threads[1];
              const workerFilename = `invocation-${idx}.worker.cpuprofile`;
              await saveProfile(workerProfile, join(outputDir, workerFilename));
              files.workerCpu = workerFilename;
            }
          }

          const capture: CaptureInfo = {
            index: idx,
            label,
            duration,
            overlappingInvocations: overlapCount,
            files,
          };
          this.state.captures.push(capture);
        },
      });
    } else {
      let sessionId: string | undefined;
      if (this.state.target === 'worker') {
        sessionId = this.options.workerManager.getSessionId(this.state.workerUrl);
      }

      this.profiler = new CpuProfiler({
        client: this.options.client,
        sessionId,
        workerUrl: this.state.workerUrl,
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
    }

    await this.profiler.start();
    this.state.active = true;

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
    const summary = this.generateSummary();
    const outputDir = this.outputDir;
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

    const outlierItems = captures.map(c => ({ label: c.label, value: c.duration }));
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

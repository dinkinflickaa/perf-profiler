import type CDP from 'chrome-remote-interface';
import type { TraceEvent, Profile } from '../types.js';
import type { WorkerManager } from '../cdp/worker-manager.js';
import { sendCommand, enableRuntime, evaluate } from '../cdp/session.js';
import { generateTracingMarkPatch, generateRestorePatch, generateAutoLabelQuery } from '../instrumentation/mark-patcher.js';
import { NavigationHandler } from '../instrumentation/navigation-handler.js';
import { extractDuration, extractCpuProfiles } from '../analysis/trace-parser.js';

const TRACE_CATEGORIES = [
  'blink.user_timing',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'v8.execute',
  'disabled-by-default-v8.cpu_profiler',
];

export interface TracingProfilerOptions {
  client: CDP.Client;
  workerManager: WorkerManager;
  startMark: string;
  endMark: string;
  maxCaptures?: number;
  onCaptureStart?: (captureIndex: number) => void;
  onCaptureEnd?: (
    captureIndex: number,
    traceEvents: TraceEvent[],
    duration: number,
    cpuProfiles: Map<number, Profile>,
    label: string,
    overlapCount: number
  ) => void;
}

interface QueuedCapture {
  index: number;
  overlapCount: number;
}

export class TracingProfiler {
  private client: CDP.Client;
  private workerManager: WorkerManager;
  private options: TracingProfilerOptions;
  private patchCode: string;
  private navigationHandler: NavigationHandler;
  private bindingHandler: ((event: any) => void) | null = null;
  private tracingCompleteHandler: ((event: any) => void) | null = null;
  private dataCollectedHandler: ((event: any) => void) | null = null;
  private workerAttachHandler: ((event: any) => void) | null = null;
  private active = false;
  private tracingActive = false;
  private pendingEvents: TraceEvent[] = [];
  private captureQueue: QueuedCapture[] = [];
  private currentCaptureIndex = 0;
  private currentOverlapCount = 0;
  private captureStartTime = 0;
  private flushResolve: (() => void) | null = null;
  private instrumentedWorkers = new Set<string>();

  constructor(options: TracingProfilerOptions) {
    this.options = options;
    this.client = options.client;
    this.workerManager = options.workerManager;
    this.patchCode = generateTracingMarkPatch(
      options.startMark,
      options.endMark,
      options.maxCaptures ?? 50
    );
    this.navigationHandler = new NavigationHandler({
      client: this.client,
      patchCode: this.patchCode,
    });
  }

  async start(): Promise<void> {
    this.active = true;

    // Instrument main thread
    await enableRuntime(this.client);
    await sendCommand(this.client, 'Runtime.addBinding', { name: '__cfp_signal' });
    await evaluate(this.client, this.patchCode);

    // Instrument all existing workers
    for (const worker of this.workerManager.getWorkers()) {
      await this.instrumentWorker(worker.sessionId);
    }

    // Watch for new workers and instrument them
    this.workerAttachHandler = async (event: any) => {
      if (!this.active) return;
      const { sessionId, targetInfo } = event;
      if (targetInfo.type === 'worker' || targetInfo.type === 'service_worker') {
        await this.instrumentWorker(sessionId);
      }
    };
    this.client.on('Target.attachedToTarget' as any, this.workerAttachHandler);

    // Start navigation handler for re-injection on main thread
    await this.navigationHandler.start();

    // Listen for binding calls (from any context — main or worker)
    this.bindingHandler = (event: any) => {
      if (!this.active) return;
      if (event.name !== '__cfp_signal') return;
      const payload: string = event.payload;
      this.handleSignal(payload);
    };
    this.client.on('Runtime.bindingCalled' as any, this.bindingHandler);

    // Listen for tracing data
    this.dataCollectedHandler = (event: any) => {
      if (event.value) {
        this.pendingEvents.push(...event.value);
      }
    };
    this.client.on('Tracing.dataCollected' as any, this.dataCollectedHandler);

    // Listen for tracing complete
    this.tracingCompleteHandler = () => {
      this.tracingActive = false;
      if (this.flushResolve) {
        this.flushResolve();
        this.flushResolve = null;
      }
    };
    this.client.on('Tracing.tracingComplete' as any, this.tracingCompleteHandler);
  }

  async stop(): Promise<void> {
    this.active = false;
    this.navigationHandler.stop();

    // If tracing is active, stop it
    if (this.tracingActive) {
      try {
        await sendCommand(this.client, 'Tracing.end');
        await this.waitForTracingComplete();
      } catch {
        // Best effort
      }
    }

    if (this.bindingHandler) {
      this.client.removeListener('Runtime.bindingCalled' as any, this.bindingHandler);
      this.bindingHandler = null;
    }
    if (this.dataCollectedHandler) {
      this.client.removeListener('Tracing.dataCollected' as any, this.dataCollectedHandler);
      this.dataCollectedHandler = null;
    }
    if (this.tracingCompleteHandler) {
      this.client.removeListener('Tracing.tracingComplete' as any, this.tracingCompleteHandler);
      this.tracingCompleteHandler = null;
    }
    if (this.workerAttachHandler) {
      this.client.removeListener('Target.attachedToTarget' as any, this.workerAttachHandler);
      this.workerAttachHandler = null;
    }

    // Restore main thread
    try {
      await sendCommand(this.client, 'Runtime.removeBinding', { name: '__cfp_signal' });
    } catch {
      // Binding may not exist
    }
    try {
      await evaluate(this.client, generateRestorePatch());
    } catch {
      // Page may have navigated
    }

    // Restore workers
    for (const sessionId of this.instrumentedWorkers) {
      try {
        await evaluate(this.client, generateRestorePatch(), sessionId);
      } catch {
        // Worker may be gone
      }
    }
    this.instrumentedWorkers.clear();
  }

  private async instrumentWorker(sessionId: string): Promise<void> {
    if (this.instrumentedWorkers.has(sessionId)) return;
    try {
      await enableRuntime(this.client, sessionId);
      await sendCommand(this.client, 'Runtime.addBinding', { name: '__cfp_signal' }, sessionId);
      await evaluate(this.client, this.patchCode, sessionId);
      this.instrumentedWorkers.add(sessionId);
    } catch {
      // Worker may have been destroyed
    }
  }

  private handleSignal(payload: string): void {
    if (payload.startsWith('start:')) {
      const index = parseInt(payload.slice(6), 10);
      this.startCapture(index);
    } else if (payload.startsWith('end:')) {
      const parts = payload.slice(4).split(':');
      const index = parseInt(parts[0], 10);
      const overlapCount = parts[1] ? parseInt(parts[1], 10) : 1;
      this.endCapture(index, overlapCount);
    }
  }

  private async startCapture(index: number): Promise<void> {
    if (this.tracingActive) {
      // Queue this capture — previous trace still flushing
      this.captureQueue.push({ index, overlapCount: 1 });
      return;
    }

    this.currentCaptureIndex = index;
    this.captureStartTime = performance.now();
    this.pendingEvents = [];
    this.options.onCaptureStart?.(index);

    try {
      this.tracingActive = true;
      await sendCommand(this.client, 'Tracing.start', {
        categories: TRACE_CATEGORIES.join(','),
        options: 'sampling-frequency=10000', // 10kHz sampling
      });
    } catch (err) {
      this.tracingActive = false;
    }
  }

  private async endCapture(index: number, overlapCount: number): Promise<void> {
    if (!this.tracingActive) return;

    this.currentOverlapCount = overlapCount;

    try {
      await sendCommand(this.client, 'Tracing.end');
      await this.waitForTracingComplete();
    } catch {
      this.tracingActive = false;
    }

    // Process the captured events
    const events = this.pendingEvents;
    this.pendingEvents = [];

    // Duration from server-side timestamps (start mark triggers Tracing.start
    // so the start mark itself is not captured in the trace)
    const serverDuration = performance.now() - this.captureStartTime;
    // Try trace-based duration as fallback, but prefer server timing
    const traceDuration = extractDuration(events, this.options.startMark, this.options.endMark);
    const duration = traceDuration > 0 ? traceDuration : serverDuration;
    const cpuProfiles = extractCpuProfiles(events);

    // Auto-label
    let label = `invocation-${index}`;
    try {
      const autoLabel = await evaluate(this.client, generateAutoLabelQuery());
      if (autoLabel && typeof autoLabel === 'string') {
        label = autoLabel;
      }
    } catch {
      // Auto-label failed
    }

    this.options.onCaptureEnd?.(index, events, duration, cpuProfiles, label, overlapCount);

    // Process queued captures
    if (this.captureQueue.length > 0) {
      const next = this.captureQueue.shift()!;
      await this.startCapture(next.index);
    }
  }

  private waitForTracingComplete(): Promise<void> {
    if (!this.tracingActive) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.flushResolve = resolve;
      // Safety timeout
      setTimeout(() => {
        if (this.flushResolve === resolve) {
          this.tracingActive = false;
          this.flushResolve = null;
          resolve();
        }
      }, 10000);
    });
  }
}

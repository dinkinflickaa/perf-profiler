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
    await enableProfiler(this.client, this.options.samplingInterval ?? 200, this.sessionId);

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
        const autoLabel = await evaluate(this.client, generateAutoLabelQuery(), this.sessionId);
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

    if (this.startHandler) {
      this.client.removeListener('Profiler.consoleProfileStarted' as any, this.startHandler);
      this.startHandler = null;
    }
    if (this.endHandler) {
      this.client.removeListener('Profiler.consoleProfileFinished' as any, this.endHandler);
      this.endHandler = null;
    }

    try {
      await evaluate(this.client, generateRestorePatch(), this.sessionId);
    } catch {
      // Page may have navigated — patch already gone
    }
  }
}

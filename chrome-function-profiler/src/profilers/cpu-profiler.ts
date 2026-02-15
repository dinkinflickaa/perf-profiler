import type CDP from 'chrome-remote-interface';
import type { Profile } from '../types.js';
import { enableProfiler, enableRuntime, evaluate, sendCommand } from '../cdp/session.js';
import { generateMarkPatch, generateRestorePatch, parseCaptureTitle, generateAutoLabelQuery } from '../instrumentation/mark-patcher.js';
import { NavigationHandler } from '../instrumentation/navigation-handler.js';

export interface CpuProfilerOptions {
  client: CDP.Client;
  sessionId?: string;
  workerUrl?: string;
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
  private workerUrl?: string;
  private patchCode: string;
  private navigationHandler: NavigationHandler;
  private startHandler: ((event: any) => void) | null = null;
  private endHandler: ((event: any) => void) | null = null;
  private workerAttachHandler: ((event: any) => void) | null = null;
  private options: CpuProfilerOptions;
  private active = false;

  constructor(options: CpuProfilerOptions) {
    this.options = options;
    this.client = options.client;
    this.sessionId = options.sessionId;
    this.workerUrl = options.workerUrl;
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

    await this.instrumentTarget(this.sessionId);

    // Start navigation handler for re-injection on same-session navigations
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

      // Auto-label: always run on main thread (workers have no DOM)
      let label = `invocation-${captureIndex}`;
      try {
        const autoLabel = await evaluate(this.client, generateAutoLabelQuery());
        if (autoLabel && typeof autoLabel === 'string') {
          label = autoLabel;
        }
      } catch {
        // Auto-label failed — use default
      }

      this.options.onCaptureEnd?.(captureIndex, profile, label, overlapCount);
    };
    this.client.on('Profiler.consoleProfileFinished' as any, this.endHandler);

    // For worker targets: watch for worker re-creation (e.g. page reload)
    if (this.workerUrl) {
      this.workerAttachHandler = async (event: any) => {
        if (!this.active) return;
        const { sessionId, targetInfo } = event;
        if ((targetInfo.type === 'worker' || targetInfo.type === 'service_worker') &&
            targetInfo.url.includes(this.workerUrl!)) {
          // Worker was recreated — update sessionId and re-instrument
          this.sessionId = sessionId;
          this.navigationHandler.updateSessionId(sessionId);
          try {
            await this.instrumentTarget(sessionId);
          } catch {
            // Worker may have been destroyed again before we could instrument
          }
        }
      };
      this.client.on('Target.attachedToTarget' as any, this.workerAttachHandler);
    }
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
    if (this.workerAttachHandler) {
      this.client.removeListener('Target.attachedToTarget' as any, this.workerAttachHandler);
      this.workerAttachHandler = null;
    }

    try {
      await evaluate(this.client, generateRestorePatch(), this.sessionId);
    } catch {
      // Page may have navigated — patch already gone
    }
  }

  private async instrumentTarget(sessionId?: string): Promise<void> {
    await enableProfiler(this.client, this.options.samplingInterval ?? 200, sessionId);
    await enableRuntime(this.client, sessionId);
    await evaluate(this.client, this.patchCode, sessionId);
  }
}

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
      if (event.context?.auxData?.isDefault) {
        this.onNavigationDetected?.(event.context.id);
        try {
          await sendCommand(this.client, 'Runtime.evaluate', { expression: this.patchCode }, this.sessionId);
          this.onReinjected?.();
        } catch {
          // Context may have been destroyed again
        }
      }
    };
    this.client.on('Runtime.executionContextCreated' as any, this.handler);
  }

  setCaptureInFlight(inFlight: boolean): void { this.captureInFlight = inFlight; }
  isCaptureInFlight(): boolean { return this.captureInFlight; }
  updateSessionId(sessionId: string): void { this.sessionId = sessionId; }

  stop(): void {
    this.active = false;
    if (this.handler) {
      this.client.removeListener('Runtime.executionContextCreated' as any, this.handler);
      this.handler = null;
    }
  }
}

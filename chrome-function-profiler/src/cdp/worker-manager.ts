import type CDP from 'chrome-remote-interface';
import type { WorkerSession } from '../types.js';

export class WorkerManager {
  private workers = new Map<string, WorkerSession>();
  private client: CDP.Client;
  private attachHandler: ((event: any) => void) | null = null;
  private detachHandler: ((event: any) => void) | null = null;

  constructor(client: CDP.Client) {
    this.client = client;
  }

  async start(): Promise<void> {
    this.attachHandler = (event: any) => {
      const { sessionId, targetInfo } = event;
      if (targetInfo.type === 'worker' || targetInfo.type === 'service_worker') {
        this.workers.set(sessionId, { sessionId, url: targetInfo.url, type: targetInfo.type });
      }
    };
    this.client.on('Target.attachedToTarget' as any, this.attachHandler);

    this.detachHandler = (event: any) => {
      this.workers.delete(event.sessionId);
    };
    this.client.on('Target.detachedFromTarget' as any, this.detachHandler);

    await (this.client as any).send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
  }

  getWorkers(): WorkerSession[] { return Array.from(this.workers.values()); }

  findByUrl(urlFragment: string): WorkerSession[] {
    return this.getWorkers().filter(w => w.url.includes(urlFragment));
  }

  getSessionId(urlFragment?: string): string | undefined {
    if (!urlFragment) return undefined;
    const matches = this.findByUrl(urlFragment);
    if (matches.length === 1) return matches[0].sessionId;
    if (matches.length > 1) throw new Error(`Multiple workers match "${urlFragment}": ${matches.map(m => m.url).join(', ')}. Use list_targets to disambiguate.`);
    throw new Error(`No worker found matching "${urlFragment}".`);
  }

  clear(): void {
    if (this.attachHandler) {
      this.client.removeListener('Target.attachedToTarget' as any, this.attachHandler);
      this.attachHandler = null;
    }
    if (this.detachHandler) {
      this.client.removeListener('Target.detachedFromTarget' as any, this.detachHandler);
      this.detachHandler = null;
    }
    this.workers.clear();
  }
}

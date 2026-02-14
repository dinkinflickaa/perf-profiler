import CDP from 'chrome-remote-interface';

export interface ConnectionOptions {
  port?: number;
  host?: string;
}

export interface CDPConnection {
  client: CDP.Client;
  port: number;
  host: string;
  close(): Promise<void>;
}

export async function createConnection(options: ConnectionOptions = {}): Promise<CDPConnection> {
  const port = options.port ?? 9222;
  const host = options.host ?? '127.0.0.1';
  const client = await CDP({ port, host });
  return {
    client, port, host,
    async close() {
      try { await client.close(); } catch { /* already closed */ }
    },
  };
}

export async function listCDPTargets(options: ConnectionOptions = {}): Promise<Array<{ id: string; type: string; url: string; title: string }>> {
  const port = options.port ?? 9222;
  const host = options.host ?? '127.0.0.1';
  const targets = await CDP.List({ port, host });
  return targets.map((t: any) => ({ id: t.id, type: t.type, url: t.url, title: t.title }));
}

import CDP from 'chrome-remote-interface';

export interface ConnectionOptions {
  port?: number;
  host?: string;
  target?: string;
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

  let target: string | undefined = options.target;

  // If a target URL fragment is given, resolve it to a target ID
  if (target && !target.match(/^[0-9A-F]{32}$/i)) {
    const targets = await CDP.List({ port, host });
    const match = targets.find((t: any) =>
      t.type === 'page' && t.url.includes(target!)
    );
    if (match) {
      target = match.id;
    }
  }

  const client = await CDP({ port, host, target });
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

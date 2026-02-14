declare module 'chrome-remote-interface' {
  interface CDPClient {
    close(): Promise<void>;
    send(method: string, params?: Record<string, unknown>): Promise<any>;
    on(event: string, callback: (params: any) => void): void;
    removeListener(event: string, callback: (params: any) => void): void;
  }

  interface CDPOptions {
    port?: number;
    host?: string;
    target?: string;
  }

  interface CDPTarget {
    id: string;
    type: string;
    url: string;
    title: string;
  }

  function CDP(options?: CDPOptions): Promise<CDPClient>;

  namespace CDP {
    type Client = CDPClient;
    function List(options?: { port?: number; host?: string }): Promise<CDPTarget[]>;
  }

  export = CDP;
}

import type CDP from 'chrome-remote-interface';

export async function sendCommand(
  client: CDP.Client,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string
): Promise<any> {
  if (sessionId) {
    return (client as any).send(method, params, sessionId);
  }
  return client.send(method as any, params as any);
}

export async function enableProfiler(
  client: CDP.Client,
  samplingInterval: number = 200,
  sessionId?: string
): Promise<void> {
  await sendCommand(client, 'Profiler.enable', {}, sessionId);
  await sendCommand(client, 'Profiler.setSamplingInterval', { interval: samplingInterval }, sessionId);
}

export async function enableRuntime(client: CDP.Client, sessionId?: string): Promise<void> {
  await sendCommand(client, 'Runtime.enable', {}, sessionId);
}

export async function evaluate(
  client: CDP.Client,
  expression: string,
  sessionId?: string
): Promise<any> {
  const result = await sendCommand(client, 'Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  return result?.result?.value;
}

import { generateMessages } from './generator';
import { transformPipeline } from './pipeline';

self.onmessage = (event: MessageEvent) => {
  const { channelId, messageCount, hasThreads } = event.data;
  performance.mark('worker-process-start');
  const rawMessages = generateMessages(channelId, messageCount, hasThreads);
  const processed = transformPipeline(rawMessages, hasThreads);
  performance.mark('worker-process-end');
  self.postMessage({ channelId, messages: processed });
};

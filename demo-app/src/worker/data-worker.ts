import { generateMessages } from './generator';
import { transformPipeline, renderPreview } from './pipeline';

self.onmessage = (event: MessageEvent) => {
  const data = event.data;

  if (data.type === 'preview') {
    performance.mark('compose-preview-start');
    const html = renderPreview(data.text);
    performance.mark('compose-preview-end');
    performance.measure('compose-preview-duration', 'compose-preview-start', 'compose-preview-end');
    self.postMessage({ type: 'preview', html });
    return;
  }

  if (data.type === 'send') {
    performance.mark('message-send-start');
    // INEFFICIENCY 23: Full pipeline re-run on send
    const rawMessages = generateMessages(data.channelId, data.messageCount, data.hasThreads);
    rawMessages.push({
      id: `${data.channelId}-msg-sent-${Date.now()}`,
      authorId: 'u1',
      content: data.text,
      timestamp: Date.now(),
      reactions: [],
      attachments: [],
    });
    const processed = transformPipeline(rawMessages, data.hasThreads);
    performance.mark('message-send-end');
    performance.measure('message-send-duration', 'message-send-start', 'message-send-end');
    self.postMessage({ type: 'send', channelId: data.channelId, messages: processed });
    return;
  }

  // Existing: channel switch
  const { channelId, messageCount, hasThreads } = data;
  performance.mark('worker-process-start');
  const rawMessages = generateMessages(channelId, messageCount, hasThreads);
  const processed = transformPipeline(rawMessages, hasThreads);
  performance.mark('worker-process-end');
  self.postMessage({ channelId, messages: processed });
};

import { useState, useCallback, useRef } from 'react';
import type { ProcessedMessage, Channel } from '../types';

const worker = new Worker(
  new URL('../worker/data-worker.ts', import.meta.url),
  { type: 'module' }
);

export function useChannelData() {
  const [messages, setMessages] = useState<ProcessedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastDuration, setLastDuration] = useState<number | null>(null);
  const currentChannel = useRef<Channel | null>(null);

  const loadChannel = useCallback((channel: Channel) => {
    performance.mark('channel-switch-start');
    setLoading(true);
    currentChannel.current = channel;

    worker.postMessage({
      channelId: channel.id,
      messageCount: channel.messageCount,
      hasThreads: channel.hasThreads,
    });

    return new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        // Ignore preview/send responses
        if (event.data.type === 'preview' || event.data.type === 'send') return;
        if (event.data.channelId !== channel.id) return;
        worker.removeEventListener('message', handler);

        const workerMessages = event.data.messages;

        performance.mark('render-start');
        renderMessages(workerMessages);
        performance.mark('render-end');
        performance.measure('render-duration', 'render-start', 'render-end');

        setMessages(workerMessages);
        setLoading(false);

        performance.mark('channel-switch-end');
        const measure = performance.measure(
          'channel-switch-duration',
          'channel-switch-start',
          'channel-switch-end'
        );
        setLastDuration(measure.duration);
        resolve();
      };
      worker.addEventListener('message', handler);
    });
  }, []);

  const handleSent = useCallback(() => {
    if (currentChannel.current) {
      loadChannel(currentChannel.current);
    }
  }, [loadChannel]);

  return {
    messages,
    setMessages,
    loading,
    loadChannel,
    lastDuration,
    worker,
    currentChannel,
    handleSent,
  };
}

// INEFFICIENCY 16: Redundant template pre-computation
function renderMessages(messages: ProcessedMessage[]): void {
  for (const msg of messages) {
    const _html = `<div class="msg" data-id="${msg.id}">` +
      `<span class="author">${msg.author.name}</span>` +
      `<span class="time">${msg.formattedTime}</span>` +
      `<div class="content">${msg.contentHtml}</div>` +
      (msg.reactionSummary.length > 0
        ? `<div class="reactions">${msg.reactionSummary.map(r =>
            `<span>${r.emoji} ${r.count}</span>`
          ).join('')}</div>`
        : '') +
      `</div>`;
  }
}

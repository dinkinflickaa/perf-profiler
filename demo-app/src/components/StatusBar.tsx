import type { Channel } from '../types';

interface Props {
  channel: Channel;
  duration: number | null;
  messageCount: number;
}

export function StatusBar({ channel, duration, messageCount }: Props) {
  return (
    <footer className="status-bar">
      <span>#{channel.name}</span>
      <span>{messageCount} messages</span>
      {duration !== null && <span className="duration">Last switch: {duration.toFixed(1)}ms</span>}
    </footer>
  );
}

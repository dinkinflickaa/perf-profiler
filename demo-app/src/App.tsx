import { useState } from 'react';
import { ChannelList } from './components/ChannelList';
import { MessagePane } from './components/MessagePane';
import { StatusBar } from './components/StatusBar';
import { useChannelData } from './hooks/useChannelData';
import { CHANNELS } from './channels';
import type { Channel } from './types';

export function App() {
  const [selectedChannel, setSelectedChannel] = useState(CHANNELS[0]);
  const { messages, loading, loadChannel, lastDuration } = useChannelData();

  const handleChannelSelect = (channel: Channel) => {
    setSelectedChannel(channel);
    loadChannel(channel);
  };

  return (
    <div className="app">
      <ChannelList channels={CHANNELS} selected={selectedChannel} onSelect={handleChannelSelect} />
      <MessagePane channel={selectedChannel} messages={messages} loading={loading} />
      <StatusBar channel={selectedChannel} duration={lastDuration} messageCount={messages.length} />
    </div>
  );
}

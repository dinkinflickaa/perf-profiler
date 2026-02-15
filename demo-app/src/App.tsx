import { useState } from 'react';
import { ChannelList } from './components/ChannelList';
import { MessagePane } from './components/MessagePane';
import { ComposeBox } from './components/ComposeBox';
import { StatusBar } from './components/StatusBar';
import { SettingsPanel } from './components/SettingsPanel';
import { ThemeProvider } from './contexts/ThemeContext';
import { useChannelData } from './hooks/useChannelData';
import { useSearch } from './hooks/useSearch';
import { useReactions } from './hooks/useReactions';
import { CHANNELS } from './channels';
import type { Channel } from './types';

function AppContent() {
  const [selectedChannel, setSelectedChannel] = useState(CHANNELS[0]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    messages, setMessages, loading, loadChannel,
    lastDuration, worker, handleSent,
  } = useChannelData();

  const { results: searchResult, search, clearSearch } = useSearch(messages);
  const { toggleReaction } = useReactions(messages, setMessages);

  const handleChannelSelect = (channel: Channel) => {
    setSelectedChannel(channel);
    clearSearch();
    loadChannel(channel);
  };

  return (
    <div className="app">
      <div className="sidebar">
        <ChannelList channels={CHANNELS} selected={selectedChannel} onSelect={handleChannelSelect} />
        <button className="settings-btn" onClick={() => setSettingsOpen(!settingsOpen)}>
          {'\u2699'} Settings
        </button>
      </div>
      <div className="main-area">
        <MessagePane
          channel={selectedChannel}
          messages={messages}
          loading={loading}
          searchResult={searchResult}
          onSearch={search}
          onClearSearch={clearSearch}
          onReact={toggleReaction}
        />
        <ComposeBox
          worker={worker}
          channelId={selectedChannel.id}
          messageCount={selectedChannel.messageCount}
          hasThreads={selectedChannel.hasThreads}
          onSent={handleSent}
        />
      </div>
      <StatusBar channel={selectedChannel} duration={lastDuration} messageCount={messages.length} />
      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// INEFFICIENCY 28: ThemeProvider wraps entire app — no React.memo anywhere
export function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

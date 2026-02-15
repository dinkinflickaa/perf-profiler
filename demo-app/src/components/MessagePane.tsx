import { useState } from 'react';
import type { Channel, ProcessedMessage, SearchResult } from '../types';
import { SearchBar } from './SearchBar';
import { ReactionPicker } from './ReactionPicker';

interface Props {
  channel: Channel;
  messages: ProcessedMessage[];
  loading: boolean;
  searchResult: SearchResult | null;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  onReact: (messageId: string, emojiName: string) => void;
}

export function MessagePane({
  channel, messages, loading,
  searchResult, onSearch, onClearSearch, onReact,
}: Props) {
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
  // INEFFICIENCY 26: Global expanded set — toggling re-renders entire list
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  const toggleThread = (messageId: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const displayMessages = searchResult ? searchResult.messages : messages;

  if (loading) {
    return (
      <main className="message-pane">
        <div className="message-pane-header"><h2># {channel.name}</h2></div>
        <div className="loading">Loading messages...</div>
      </main>
    );
  }

  return (
    <main className="message-pane">
      <div className="message-pane-header">
        <h2># {channel.name}</h2>
        <SearchBar
          onSearch={onSearch}
          onClear={onClearSearch}
          resultCount={searchResult ? searchResult.count : null}
        />
        <span className="message-count">{displayMessages.length} messages</span>
      </div>
      <div className="message-list">
        {displayMessages.map(msg => (
          <div
            key={msg.id}
            className="message"
            onMouseEnter={() => setHoveredMessage(msg.id)}
            onMouseLeave={() => setHoveredMessage(null)}
          >
            <div className="message-avatar">{msg.author.avatar}</div>
            <div className="message-body">
              <div className="message-header">
                <span className="author-name">{msg.author.name}</span>
                <span className="message-time">{msg.formattedTime}</span>
              </div>
              <div
                className="message-content"
                dangerouslySetInnerHTML={{
                  __html: searchResult?.highlightedHtml.get(msg.id) || msg.contentHtml,
                }}
              />
              {msg.reactionSummary.length > 0 && (
                <div className="reactions">
                  {msg.reactionSummary.map((r, i) => (
                    <span key={i} className="reaction">{r.emoji} {r.count}</span>
                  ))}
                </div>
              )}
              {hoveredMessage === msg.id && (
                <ReactionPicker messageId={msg.id} onReact={onReact} />
              )}
              {msg.threadMessages && msg.threadMessages.length > 0 && (
                <div className="thread">
                  <button
                    className="thread-count"
                    onClick={() => toggleThread(msg.id)}
                  >
                    {expandedThreads.has(msg.id)
                      ? `\u25BE Hide ${msg.threadMessages.length} replies`
                      : `\u25B8 ${msg.threadMessages.length} replies`}
                  </button>
                  {expandedThreads.has(msg.id) && (
                    <div className="thread-replies">
                      {msg.threadMessages.map(reply => (
                        <div key={reply.id} className="message thread-reply">
                          <div className="message-avatar">{reply.author.avatar}</div>
                          <div className="message-body">
                            <div className="message-header">
                              <span className="author-name">{reply.author.name}</span>
                              <span className="message-time">{reply.formattedTime}</span>
                            </div>
                            <div
                              className="message-content"
                              dangerouslySetInnerHTML={{ __html: reply.contentHtml }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

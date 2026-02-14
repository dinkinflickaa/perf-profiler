import type { Channel, ProcessedMessage } from '../types';

interface Props {
  channel: Channel;
  messages: ProcessedMessage[];
  loading: boolean;
}

export function MessagePane({ channel, messages, loading }: Props) {
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
        <span className="message-count">{messages.length} messages</span>
      </div>
      <div className="message-list">
        {messages.map(msg => (
          <div key={msg.id} className="message">
            <div className="message-avatar">{msg.author.avatar}</div>
            <div className="message-body">
              <div className="message-header">
                <span className="author-name">{msg.author.name}</span>
                <span className="message-time">{msg.formattedTime}</span>
              </div>
              <div className="message-content" dangerouslySetInnerHTML={{ __html: msg.contentHtml }} />
              {msg.reactionSummary.length > 0 && (
                <div className="reactions">
                  {msg.reactionSummary.map((r, i) => (
                    <span key={i} className="reaction">{r.emoji} {r.count}</span>
                  ))}
                </div>
              )}
              {msg.threadMessages && msg.threadMessages.length > 0 && (
                <div className="thread"><div className="thread-count">{msg.threadMessages.length} replies</div></div>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

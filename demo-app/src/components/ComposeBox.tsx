import { useState, useEffect, useRef } from 'react';

interface Props {
  worker: Worker;
  channelId: string;
  messageCount: number;
  hasThreads: boolean;
  onSent: () => void;
}

export function ComposeBox({ worker, channelId, messageCount, hasThreads, onSent }: Props) {
  const [text, setText] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'preview') {
        setPreviewHtml(event.data.html);
      }
      if (event.data.type === 'send') {
        setText('');
        setPreviewHtml('');
        onSent();
      }
    };
    listenerRef.current = handler;
    worker.addEventListener('message', handler);
    return () => worker.removeEventListener('message', handler);
  }, [worker, onSent]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);

    if (value.trim()) {
      worker.postMessage({ type: 'preview', text: value });
      setShowPreview(true);
    } else {
      setPreviewHtml('');
      setShowPreview(false);
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    worker.postMessage({
      type: 'send',
      channelId,
      messageCount,
      hasThreads,
      text: text.trim(),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  };

  return (
    <div className="compose-box">
      {showPreview && previewHtml && (
        <div className="compose-preview">
          <div className="compose-preview-label">Preview</div>
          <div
            className="compose-preview-content message-content"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      )}
      <div className="compose-input-row">
        <textarea
          className="compose-textarea"
          placeholder="Type a message... (Cmd+Enter to send)"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <button
          className="compose-send"
          onClick={handleSend}
          disabled={!text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

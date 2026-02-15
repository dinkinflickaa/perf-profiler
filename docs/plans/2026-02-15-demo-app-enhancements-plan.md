# Demo App Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 4 features (search, compose, reactions, theme) to the demo chat app, each with distinct performance patterns, intentional bottlenecks, and performance marks for profiling practice.

**Architecture:** Each feature exercises a different performance pattern — main-thread CPU-bound (search), cross-thread worker round-trip (compose), frequent small updates (reactions), and cascading re-render (theme). All features integrate into the existing React chat app shell via new hooks and components, reusing the existing worker and pipeline infrastructure.

**Tech Stack:** React 19, TypeScript, Vite, Web Workers

**Design doc:** `docs/plans/2026-02-15-demo-app-enhancements-design.md`

---

### Task 1: Extend Types

**Files:**
- Modify: `demo-app/src/types.ts`

**Step 1: Add new type definitions**

Add these types to the end of `types.ts`:

```typescript
export type Theme = 'dark' | 'light';
export type Density = 'compact' | 'comfortable' | 'spacious';

export interface ThemeContextValue {
  theme: Theme;
  density: Density;
  toggleTheme: () => void;
  setDensity: (d: Density) => void;
}

export interface SearchResult {
  messages: ProcessedMessage[];
  highlightedHtml: Map<string, string>;
  count: number;
}

export interface WorkerRequest {
  type?: 'channel' | 'preview' | 'send';
  channelId?: string;
  messageCount?: number;
  hasThreads?: boolean;
  text?: string;
}

export interface WorkerResponse {
  type?: 'channel' | 'preview' | 'send';
  channelId?: string;
  messages?: ProcessedMessage[];
  html?: string;
}
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
git add demo-app/src/types.ts
git commit -m "feat(demo): extend types for search, compose, reactions, theme"
```

---

### Task 2: Theme Context + Hook

**Files:**
- Create: `demo-app/src/contexts/ThemeContext.tsx`

**Step 1: Create ThemeContext with intentional inefficiencies**

```tsx
import { createContext, useState, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { Theme, Density, ThemeContextValue } from '../types';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [density, setDensity] = useState<Density>('comfortable');
  const isToggling = useRef(false);

  const toggleTheme = () => {
    performance.mark('theme-switch-start');
    isToggling.current = true;
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  };

  // INEFFICIENCY 27: Forced layout thrashing
  // Instead of swapping a CSS class on <html>, iterates every .message element
  // and sets inline styles. Read-write-read-write pattern forces layout recalc.
  useEffect(() => {
    const isDark = theme === 'dark';

    // Set data attributes for CSS variable theming
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-density', density);

    // Layout thrashing: read offsetHeight then write style for each element
    const messages = document.querySelectorAll('.message');
    messages.forEach(el => {
      const htmlEl = el as HTMLElement;
      const _height = htmlEl.offsetHeight; // force layout read
      htmlEl.style.color = isDark ? '#d0d8e8' : '#2a2a3e';
      htmlEl.style.backgroundColor = isDark ? 'transparent' : '#ffffff';
    });

    const avatars = document.querySelectorAll('.message-avatar');
    avatars.forEach(el => {
      const htmlEl = el as HTMLElement;
      const _width = htmlEl.offsetWidth; // force layout read
      htmlEl.style.backgroundColor = isDark ? '#2a5a9a' : '#e0e8f0';
      htmlEl.style.color = isDark ? '#c0d8f8' : '#2a5a9a';
    });

    if (isToggling.current) {
      performance.mark('theme-switch-end');
      performance.measure('theme-switch-duration', 'theme-switch-start', 'theme-switch-end');
      isToggling.current = false;
    }
  }, [theme, density]);

  // INEFFICIENCY 28: No memo — context value is a new object every render,
  // forcing all consumers to re-render even if theme/density haven't changed
  return (
    <ThemeContext.Provider value={{ theme, density, toggleTheme, setDensity }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`

**Step 3: Commit**

```
git add demo-app/src/contexts/ThemeContext.tsx
git commit -m "feat(demo): add ThemeContext with layout thrashing inefficiency"
```

---

### Task 3: Search Hook

**Files:**
- Create: `demo-app/src/hooks/useSearch.ts`

**Step 1: Create useSearch with 4 intentional inefficiencies**

```typescript
import { useState, useCallback } from 'react';
import type { ProcessedMessage, SearchResult } from '../types';

export function useSearch(allMessages: ProcessedMessage[]) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);

  const search = useCallback((searchText: string) => {
    setQuery(searchText);

    if (!searchText.trim()) {
      setResults(null);
      return;
    }

    performance.mark('search-start');

    // INEFFICIENCY 17: No memoization — re-scans ALL messages from scratch
    // on every keystroke, even if user just added one character
    const filtered: ProcessedMessage[] = [];
    const highlights = new Map<string, string>();
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    for (const msg of allMessages) {
      // INEFFICIENCY 18: New RegExp per message instead of compiling once
      const regex = new RegExp(escaped, 'gi');

      if (regex.test(msg.contentHtml) || regex.test(msg.author.name)) {
        filtered.push(msg);

        // INEFFICIENCY 19: 3-pass highlight injection
        let html = msg.contentHtml;

        // Pass 1: wrap matches in <mark>
        const hlRegex1 = new RegExp(`(${escaped})`, 'gi');
        html = html.replace(hlRegex1, '<mark>$1</mark>');

        // Pass 2: re-parse bold/italic inside highlights (unnecessary)
        const hlRegex2 = new RegExp(`(${escaped})`, 'gi');
        html = html.replace(/<mark>(.*?)<\/mark>/g, (match, inner) => {
          const reprocessed = inner.replace(hlRegex2, '<mark>$1</mark>');
          return `<mark class="search-highlight">${reprocessed}</mark>`;
        });

        // Pass 3: re-apply markdown transformations (already done in pipeline)
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

        highlights.set(msg.id, html);
      }
    }

    // INEFFICIENCY 20: Unnecessary copy + re-sort
    // Source is already sorted, but we spread into new array and re-sort anyway
    const sorted = [...filtered].sort((a, b) =>
      new Date(a.timestamp).toISOString().localeCompare(
        new Date(b.timestamp).toISOString()
      )
    );

    setResults({
      messages: sorted,
      highlightedHtml: highlights,
      count: sorted.length,
    });

    performance.mark('search-end');
    performance.measure('search-duration', 'search-start', 'search-end');
  }, [allMessages]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults(null);
  }, []);

  return { query, results, search, clearSearch };
}
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`

**Step 3: Commit**

```
git add demo-app/src/hooks/useSearch.ts
git commit -m "feat(demo): add useSearch hook with 4 intentional inefficiencies"
```

---

### Task 4: Reactions Hook

**Files:**
- Create: `demo-app/src/hooks/useReactions.ts`

**Step 1: Create useReactions with 2 intentional inefficiencies**

```typescript
import { useCallback } from 'react';
import type { ProcessedMessage } from '../types';

const EMOJI_MAP: Record<string, string> = {
  thumbsup: '\u{1F44D}', heart: '\u2764\uFE0F', fire: '\u{1F525}',
  rocket: '\u{1F680}', eyes: '\u{1F440}', tada: '\u{1F389}',
  thinking: '\u{1F914}', '100': '\u{1F4AF}', wave: '\u{1F44B}',
  pray: '\u{1F64F}', white_check_mark: '\u2705',
};

export const REACTION_EMOJIS = Object.entries(EMOJI_MAP).map(([name, emoji]) => ({
  name,
  emoji,
}));

// Duplicated from pipeline.ts — same uncached author lookup
function resolveAuthor(authorId: string): { id: string; name: string; avatar: string } {
  const users = [
    { id: 'u1', name: 'Alice Chen', avatar: 'ac' },
    { id: 'u2', name: 'Bob Martinez', avatar: 'bm' },
    { id: 'u3', name: 'Carol Wang', avatar: 'cw' },
    { id: 'u4', name: 'David Kim', avatar: 'dk' },
    { id: 'u5', name: 'Eva Gonzalez', avatar: 'eg' },
    { id: 'u6', name: 'Frank Liu', avatar: 'fl' },
    { id: 'u7', name: 'Grace Park', avatar: 'gp' },
    { id: 'u8', name: 'Hiro Tanaka', avatar: 'ht' },
    { id: 'u9', name: 'Iris Novak', avatar: 'in' },
    { id: 'u10', name: 'Jake Wilson', avatar: 'jw' },
    { id: 'u11', name: 'Kara Johnson', avatar: 'kj' },
    { id: 'u12', name: 'Leo Smith', avatar: 'ls' },
    { id: 'u13', name: 'Maya Patel', avatar: 'mp' },
    { id: 'u14', name: 'Noah Brown', avatar: 'nb' },
    { id: 'u15', name: 'Olivia Davis', avatar: 'od' },
    { id: 'u16', name: 'Paul Garcia', avatar: 'pg' },
    { id: 'u17', name: 'Quinn Taylor', avatar: 'qt' },
    { id: 'u18', name: 'Ruby Anderson', avatar: 'ra' },
    { id: 'u19', name: 'Sam Thomas', avatar: 'st' },
    { id: 'u20', name: 'Tina Martin', avatar: 'tm' },
  ];
  return users.find(u => u.id === authorId) || { id: authorId, name: 'Unknown', avatar: '??' };
}

function decodeEmoji(name: string): string {
  // Rebuild map on every call (same as pipeline inefficiency 9)
  const map: Record<string, string> = {
    thumbsup: '\u{1F44D}', heart: '\u2764\uFE0F', fire: '\u{1F525}',
    rocket: '\u{1F680}', eyes: '\u{1F440}', tada: '\u{1F389}',
    thinking: '\u{1F914}', '100': '\u{1F4AF}', wave: '\u{1F44B}',
    pray: '\u{1F64F}', white_check_mark: '\u2705',
  };
  return map[name] || name;
}

export function useReactions(
  messages: ProcessedMessage[],
  setMessages: (msgs: ProcessedMessage[]) => void,
) {
  const toggleReaction = useCallback((messageId: string, emojiName: string) => {
    performance.mark('reaction-start');

    // INEFFICIENCY 25: JSON round-trip deep clone of ALL messages
    const cloned: ProcessedMessage[] = JSON.parse(JSON.stringify(messages));

    // Find and toggle the reaction on the target message
    const target = cloned.find(m => m.id === messageId);
    if (target) {
      if (!target.reactions) target.reactions = [];
      const existing = target.reactions.find(r => r.emoji === emojiName);
      if (existing) {
        const idx = existing.userIds.indexOf('u1');
        if (idx >= 0) {
          existing.userIds.splice(idx, 1);
          if (existing.userIds.length === 0) {
            target.reactions = target.reactions.filter(r => r.emoji !== emojiName);
          }
        } else {
          existing.userIds.push('u1');
        }
      } else {
        target.reactions.push({ emoji: emojiName, userIds: ['u1'] });
      }
    }

    // INEFFICIENCY 24: Full reaction re-resolve on ALL messages
    // Re-resolves every reactor name via uncached resolveAuthor for every message
    const withReactions = cloned.map(msg => {
      if (!msg.reactions || msg.reactions.length === 0) return msg;
      return {
        ...msg,
        reactionSummary: msg.reactions.map(r => ({
          emoji: decodeEmoji(r.emoji),
          count: r.userIds.length,
          names: r.userIds.map(uid => resolveAuthor(uid).name),
        })),
      };
    });

    setMessages(withReactions);

    performance.mark('reaction-end');
    performance.measure('reaction-duration', 'reaction-start', 'reaction-end');
  }, [messages, setMessages]);

  return { toggleReaction };
}
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`

**Step 3: Commit**

```
git add demo-app/src/hooks/useReactions.ts
git commit -m "feat(demo): add useReactions hook with JSON clone + full re-resolve"
```

---

### Task 5: Worker Changes for Compose

**Files:**
- Modify: `demo-app/src/worker/pipeline.ts` — export `renderPreview()`, export `parseMarkdown` (already exists, just export)
- Modify: `demo-app/src/worker/data-worker.ts` — handle `preview` and `send` message types

**Step 1: Add renderPreview to pipeline.ts**

Add this function at the end of `demo-app/src/worker/pipeline.ts`:

```typescript
// --- Compose Preview Pipeline ---

export function renderPreview(text: string): string {
  // INEFFICIENCY 21: Full re-parse of everything on every keystroke
  // No debounce, no diffing — full pipeline for every character typed
  let html = parseMarkdown(text);
  const _mentions = extractMentions(text);  // Unused result, but still computed
  const _emojis = decodeEmojis(text);        // Unused result, but still computed

  // INEFFICIENCY 22: Synthetic link unfurl simulation
  // For each URL, builds preview metadata via regex + hardcoded lookup
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlRegex) || [];
  const unfurls: string[] = [];

  for (const url of urls) {
    // Rebuild metadata map on every URL (allocation pressure)
    const urlMetadata: Record<string, { title: string; desc: string }> = {
      'https://example.com': { title: 'Example Domain', desc: 'This domain is for use in illustrative examples.' },
      'https://github.com': { title: 'GitHub', desc: 'Where the world builds software.' },
      'https://docs.example.com': { title: 'Documentation', desc: 'Read the docs for more information.' },
      'https://api.example.com': { title: 'API Reference', desc: 'Complete API documentation and guides.' },
      'https://blog.example.com': { title: 'Engineering Blog', desc: 'Technical articles from the team.' },
    };

    // Try each key with startsWith (linear scan per URL)
    for (const [pattern, meta] of Object.entries(urlMetadata)) {
      if (url.startsWith(pattern)) {
        unfurls.push(
          `<div class="unfurl"><strong>${meta.title}</strong><p>${meta.desc}</p></div>`
        );
        break;
      }
    }
  }

  if (unfurls.length > 0) {
    html += '\n<div class="unfurls">' + unfurls.join('') + '</div>';
  }

  return html;
}
```

**Step 2: Update data-worker.ts to handle preview and send**

Replace the entire contents of `demo-app/src/worker/data-worker.ts`:

```typescript
import { generateMessages } from './generator';
import { transformPipeline, renderPreview } from './pipeline';

self.onmessage = (event: MessageEvent) => {
  const data = event.data;

  // Compose preview: render markdown in worker
  if (data.type === 'preview') {
    performance.mark('compose-preview-start');
    const html = renderPreview(data.text);
    performance.mark('compose-preview-end');
    performance.measure('compose-preview-duration', 'compose-preview-start', 'compose-preview-end');
    self.postMessage({ type: 'preview', html });
    return;
  }

  // Send message: re-generate + re-process entire pipeline
  if (data.type === 'send') {
    performance.mark('message-send-start');

    // INEFFICIENCY 23: Full pipeline re-run on send
    // Regenerates ALL messages + appends new one, then processes everything
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
```

**Step 3: Verify build**

Run: `cd demo-app && npx tsc --noEmit`

**Step 4: Commit**

```
git add demo-app/src/worker/pipeline.ts demo-app/src/worker/data-worker.ts
git commit -m "feat(demo): add compose preview + send to worker with link unfurl inefficiency"
```

---

### Task 6: SearchBar Component

**Files:**
- Create: `demo-app/src/components/SearchBar.tsx`

**Step 1: Create SearchBar component**

```tsx
import { useState, useRef, useCallback } from 'react';

interface Props {
  onSearch: (query: string) => void;
  onClear: () => void;
  resultCount: number | null;
}

export function SearchBar({ onSearch, onClear, resultCount }: Props) {
  const [value, setValue] = useState('');
  const timerRef = useRef<number | null>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setValue(text);

    // 150ms debounce
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (text.trim()) {
        onSearch(text);
      } else {
        onClear();
      }
    }, 150);
  }, [onSearch, onClear]);

  const handleClear = useCallback(() => {
    setValue('');
    onClear();
  }, [onClear]);

  return (
    <div className="search-bar">
      <input
        type="text"
        placeholder="Search messages..."
        value={value}
        onChange={handleChange}
        className="search-input"
      />
      {value && (
        <button className="search-clear" onClick={handleClear}>
          &times;
        </button>
      )}
      {resultCount !== null && (
        <span className="search-count">{resultCount} results</span>
      )}
    </div>
  );
}
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`

**Step 3: Commit**

```
git add demo-app/src/components/SearchBar.tsx
git commit -m "feat(demo): add SearchBar component with debounce"
```

---

### Task 7: ComposeBox Component

**Files:**
- Create: `demo-app/src/components/ComposeBox.tsx`

**Step 1: Create ComposeBox component**

```tsx
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

  // Listen for preview responses from worker
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

    // Send every keystroke to worker for preview (no debounce — intentional)
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
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`

**Step 3: Commit**

```
git add demo-app/src/components/ComposeBox.tsx
git commit -m "feat(demo): add ComposeBox with live preview via worker"
```

---

### Task 8: ReactionPicker Component

**Files:**
- Create: `demo-app/src/components/ReactionPicker.tsx`

**Step 1: Create ReactionPicker component**

```tsx
import { REACTION_EMOJIS } from '../hooks/useReactions';

interface Props {
  messageId: string;
  onReact: (messageId: string, emojiName: string) => void;
}

export function ReactionPicker({ messageId, onReact }: Props) {
  return (
    <div className="reaction-picker">
      {REACTION_EMOJIS.map(({ name, emoji }) => (
        <button
          key={name}
          className="reaction-picker-btn"
          onClick={(e) => {
            e.stopPropagation();
            onReact(messageId, name);
          }}
          title={name}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`

**Step 3: Commit**

```
git add demo-app/src/components/ReactionPicker.tsx
git commit -m "feat(demo): add ReactionPicker emoji button row"
```

---

### Task 9: SettingsPanel Component

**Files:**
- Create: `demo-app/src/components/SettingsPanel.tsx`

**Step 1: Create SettingsPanel component**

```tsx
import { useTheme } from '../contexts/ThemeContext';
import type { Density } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: Props) {
  const { theme, density, toggleTheme, setDensity } = useTheme();

  if (!isOpen) return null;

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>Settings</h3>
        <button className="settings-close" onClick={onClose}>&times;</button>
      </div>

      <div className="settings-section">
        <label className="settings-label">Theme</label>
        <button className="settings-toggle" onClick={toggleTheme}>
          {theme === 'dark' ? '\u263E Dark' : '\u2600 Light'}
        </button>
      </div>

      <div className="settings-section">
        <label className="settings-label">Message Density</label>
        <div className="settings-density">
          {(['compact', 'comfortable', 'spacious'] as Density[]).map(d => (
            <button
              key={d}
              className={`density-btn ${density === d ? 'active' : ''}`}
              onClick={() => setDensity(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`

**Step 3: Commit**

```
git add demo-app/src/components/SettingsPanel.tsx
git commit -m "feat(demo): add SettingsPanel with theme toggle + density selector"
```

---

### Task 10: Update MessagePane with Search, Reactions, Thread Expand

**Files:**
- Modify: `demo-app/src/components/MessagePane.tsx`

**Step 1: Rewrite MessagePane to integrate search highlights, reaction picker, and thread expand**

Replace the entire contents of `demo-app/src/components/MessagePane.tsx`:

```tsx
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
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`
Expected: May fail because App.tsx hasn't been updated yet to pass new props — that's OK, will fix in Task 12.

**Step 3: Commit**

```
git add demo-app/src/components/MessagePane.tsx
git commit -m "feat(demo): update MessagePane with search, reactions, thread expand"
```

---

### Task 11: Update useChannelData for Compose Send

**Files:**
- Modify: `demo-app/src/hooks/useChannelData.ts`

**Step 1: Add send handler and expose worker**

Replace the entire contents of `demo-app/src/hooks/useChannelData.ts`:

```typescript
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
    // Reload channel to get updated messages after send
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
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`

**Step 3: Commit**

```
git add demo-app/src/hooks/useChannelData.ts
git commit -m "feat(demo): update useChannelData to expose worker and handle send"
```

---

### Task 12: Update App.tsx — Wire Everything Together

**Files:**
- Modify: `demo-app/src/App.tsx`

**Step 1: Integrate all features in App.tsx**

Replace the entire contents of `demo-app/src/App.tsx`:

```tsx
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
// Context value changes force every consumer to re-render
export function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
```

**Step 2: Verify build**

Run: `cd demo-app && npx tsc --noEmit`
Expected: Should pass now — all components and hooks are wired.

**Step 3: Commit**

```
git add demo-app/src/App.tsx
git commit -m "feat(demo): wire up all features in App.tsx with ThemeProvider"
```

---

### Task 13: Add Styles for All New Components

**Files:**
- Modify: `demo-app/src/styles.css`

**Step 1: Add CSS for sidebar, search, compose, reactions, settings, theme, density**

Append the following to the end of `demo-app/src/styles.css`:

```css
/* ========== Sidebar Layout ========== */
.sidebar {
  display: flex;
  flex-direction: column;
  width: 240px;
  min-width: 240px;
  background: #1a1a2e;
  border-right: 1px solid #2a2a4a;
}

.sidebar .channel-list {
  flex: 1;
  width: 100%;
  min-width: unset;
  border-right: none;
}

.settings-btn {
  padding: 10px 16px;
  border: none;
  border-top: 1px solid #2a2a4a;
  background: transparent;
  color: #8888aa;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.settings-btn:hover {
  background: #22224a;
  color: #e0e0ff;
}

/* ========== Main Area ========== */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-area .message-pane {
  flex: 1;
}

/* ========== Search Bar ========== */
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px;
}

.search-input {
  width: 200px;
  padding: 5px 10px;
  border: 1px solid #2a4a6a;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  font-size: 13px;
  outline: none;
}

.search-input:focus {
  border-color: #4488cc;
}

.search-input::placeholder {
  color: #6688aa;
}

.search-clear {
  border: none;
  background: none;
  color: #8899bb;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}

.search-count {
  font-size: 12px;
  color: #6688aa;
  white-space: nowrap;
}

mark.search-highlight,
.message-content mark {
  background: rgba(255, 200, 50, 0.3);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}

/* ========== Compose Box ========== */
.compose-box {
  border-top: 1px solid #1a4a7a;
  background: #0d2d50;
  padding: 8px 16px 24px;
}

.compose-preview {
  margin-bottom: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid #1a4a7a;
  border-radius: 6px;
  max-height: 120px;
  overflow-y: auto;
}

.compose-preview-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6688aa;
  margin-bottom: 4px;
}

.compose-preview-content {
  font-size: 13px;
}

.compose-input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.compose-textarea {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #2a4a6a;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
}

.compose-textarea:focus {
  border-color: #4488cc;
}

.compose-textarea::placeholder {
  color: #6688aa;
}

.compose-send {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #2a6abb;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.compose-send:hover {
  background: #3578cc;
}

.compose-send:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ========== Link Unfurls ========== */
.unfurls {
  margin-top: 8px;
}

.unfurl {
  padding: 8px 12px;
  border-left: 3px solid #4488cc;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 0 4px 4px 0;
  margin-top: 4px;
}

.unfurl strong {
  display: block;
  color: #88bbee;
  font-size: 13px;
}

.unfurl p {
  color: #8899bb;
  font-size: 12px;
  margin-top: 2px;
}

/* ========== Reaction Picker ========== */
.reaction-picker {
  display: flex;
  gap: 2px;
  margin-top: 4px;
  padding: 4px 6px;
  background: #1a2a4a;
  border: 1px solid #2a4a6a;
  border-radius: 6px;
  width: fit-content;
}

.reaction-picker-btn {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  line-height: 1;
}

.reaction-picker-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* ========== Thread Replies ========== */
.thread-count {
  border: none;
  background: none;
  font-size: 12px;
  color: #5599dd;
  cursor: pointer;
  padding: 0;
}

.thread-count:hover {
  text-decoration: underline;
}

.thread-replies {
  margin-top: 4px;
  margin-left: 16px;
  padding-left: 12px;
  border-left: 2px solid #2a4a6a;
}

.thread-reply {
  padding: 4px 8px;
}

.thread-reply .message-avatar {
  width: 28px;
  height: 28px;
  min-width: 28px;
  font-size: 10px;
}

/* ========== Settings Panel ========== */
.settings-panel {
  position: fixed;
  top: 0;
  left: 240px;
  bottom: 24px;
  width: 280px;
  background: #12122a;
  border-right: 1px solid #2a2a4a;
  padding: 16px;
  z-index: 50;
  overflow-y: auto;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.settings-header h3 {
  font-size: 16px;
  color: #e0e0ff;
}

.settings-close {
  border: none;
  background: none;
  color: #8888aa;
  font-size: 20px;
  cursor: pointer;
}

.settings-section {
  margin-bottom: 16px;
}

.settings-label {
  display: block;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #8888aa;
  margin-bottom: 8px;
}

.settings-toggle {
  padding: 8px 16px;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  background: #1a1a2e;
  color: #e0e0ff;
  font-size: 14px;
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.settings-toggle:hover {
  background: #22224a;
}

.settings-density {
  display: flex;
  gap: 4px;
}

.density-btn {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #2a2a4a;
  border-radius: 4px;
  background: #1a1a2e;
  color: #b0b0cc;
  font-size: 12px;
  cursor: pointer;
  text-transform: capitalize;
}

.density-btn:hover {
  background: #22224a;
}

.density-btn.active {
  background: #16213e;
  border-color: #4488cc;
  color: #ffffff;
}

/* ========== Theme: Light Mode ========== */
[data-theme="light"] {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-sidebar: #f0f0f5;
  --text-primary: #1a1a2e;
  --text-secondary: #555577;
  --border-color: #d0d0e0;
}

html[data-theme="light"] .app {
  background: var(--bg-primary);
  color: var(--text-primary);
}

html[data-theme="light"] .sidebar,
html[data-theme="light"] .channel-list {
  background: var(--bg-sidebar);
  border-color: var(--border-color);
}

html[data-theme="light"] .channel-list h2 {
  color: var(--text-secondary);
  border-color: var(--border-color);
}

html[data-theme="light"] .channel-list button {
  color: var(--text-secondary);
}

html[data-theme="light"] .channel-list button:hover {
  background: #e0e0f0;
  color: var(--text-primary);
}

html[data-theme="light"] .channel-list button.active {
  background: #d8d8f0;
  color: var(--text-primary);
}

html[data-theme="light"] .message-pane {
  background: var(--bg-primary);
  border-color: var(--border-color);
}

html[data-theme="light"] .message-pane-header {
  background: var(--bg-primary);
  border-color: var(--border-color);
}

html[data-theme="light"] .message-pane-header h2 {
  color: var(--text-primary);
}

html[data-theme="light"] .message {
  border-color: #e8e8f0;
}

html[data-theme="light"] .message:hover {
  background: #f8f8fc;
}

html[data-theme="light"] .author-name {
  color: var(--text-primary);
}

html[data-theme="light"] .compose-box {
  background: var(--bg-secondary);
  border-color: var(--border-color);
}

html[data-theme="light"] .compose-textarea,
html[data-theme="light"] .search-input {
  background: #ffffff;
  border-color: var(--border-color);
  color: var(--text-primary);
}

html[data-theme="light"] .status-bar {
  background: var(--bg-secondary);
  border-color: var(--border-color);
  color: var(--text-secondary);
}

html[data-theme="light"] .settings-panel {
  background: var(--bg-secondary);
  border-color: var(--border-color);
}

html[data-theme="light"] .settings-toggle,
html[data-theme="light"] .density-btn {
  background: #ffffff;
  border-color: var(--border-color);
  color: var(--text-primary);
}

html[data-theme="light"] .reaction-picker {
  background: #ffffff;
  border-color: var(--border-color);
}

/* ========== Density Modes ========== */
[data-density="compact"] .message {
  padding: 4px 20px;
}

[data-density="compact"] .message-avatar {
  width: 24px;
  height: 24px;
  min-width: 24px;
  font-size: 9px;
}

[data-density="spacious"] .message {
  padding: 14px 20px;
}

[data-density="spacious"] .message-content {
  line-height: 1.8;
}
```

**Step 2: Update the existing `.channel-list` CSS to remove fixed width**

The `.channel-list` styles need to work inside the new `.sidebar` wrapper. Edit the existing styles:
- Remove `width: 240px;` and `min-width: 240px;` from `.channel-list`
- Remove `border-right: 1px solid #2a2a4a;` from `.channel-list` (now on `.sidebar`)

**Step 3: Verify dev server runs**

Run: `cd demo-app && npx vite --host 2>&1 | head -20`
Expected: Dev server starts, no build errors.

**Step 4: Commit**

```
git add demo-app/src/styles.css
git commit -m "feat(demo): add styles for search, compose, reactions, settings, theme"
```

---

### Task 14: Manual Verification

**Step 1: Start dev server and open in Chrome**

Run: `cd demo-app && npx vite --host`
Open the app URL in Chrome.

**Step 2: Verify each feature works**

1. **Channel switch** — Click channels, verify messages load with timing in status bar
2. **Search** — Type in the search box, verify messages filter and highlights appear
3. **Compose** — Type in the compose area, verify live preview updates. Click Send or Cmd+Enter
4. **Reactions** — Hover a message, verify emoji picker appears. Click an emoji, verify reaction count updates
5. **Thread expand** — In a channel with threads (e.g. Engineering), click reply count to expand/collapse
6. **Theme toggle** — Click Settings in sidebar, toggle theme to light/dark, verify all elements update
7. **Density** — Change density, verify message spacing changes

**Step 3: Verify performance marks fire**

Open Chrome DevTools > Console, run:
```javascript
// Monitor performance marks
const observer = new PerformanceObserver((list) => {
  list.getEntries().forEach(e => console.log(e.name, e.startTime.toFixed(1)));
});
observer.observe({ entryTypes: ['mark', 'measure'] });
```

Then trigger each scenario and verify the expected marks fire:
- Channel switch → `channel-switch-start/end`, `render-start/end`, `worker-process-start/end`
- Search → `search-start/end`
- Compose typing → `compose-preview-start/end` (in worker, not visible in main console)
- Send message → `message-send-start/end` (in worker)
- Reaction click → `reaction-start/end`
- Theme toggle → `theme-switch-start/end`

**Step 4: Final commit if any fixes needed**

```
git add -A
git commit -m "fix(demo): address issues found during manual verification"
```

---

## Summary

**Total tasks:** 14
**New files:** 8 (`ThemeContext.tsx`, `useSearch.ts`, `useReactions.ts`, `SearchBar.tsx`, `ComposeBox.tsx`, `ReactionPicker.tsx`, `SettingsPanel.tsx`)
**Modified files:** 5 (`types.ts`, `data-worker.ts`, `pipeline.ts`, `useChannelData.ts`, `App.tsx`, `MessagePane.tsx`, `styles.css`)
**New performance marks:** 5 pairs (search, compose-preview, message-send, reaction, theme-switch)
**New inefficiencies:** 12 (#17-#28)

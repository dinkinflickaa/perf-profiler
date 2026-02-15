import type { RawMessage, ProcessedMessage } from '../types';

export function transformPipeline(messages: RawMessage[], hasThreads: boolean): ProcessedMessage[] {
  // INEFFICIENCY 1: Unnecessary full copy via JSON round-trip
  // Real codebases do this "just to be safe" or for deep cloning
  const cloned = JSON.parse(JSON.stringify(messages));

  // INEFFICIENCY 2: Multiple passes over the array instead of single pass
  const normalized = normalizeMessages(cloned);
  const enriched = enrichMessages(normalized);
  const sorted = sortMessages(enriched);
  const grouped = groupByDate(sorted);
  const withThreads = hasThreads ? nestThreads(grouped) : grouped;
  const withReactions = resolveReactions(withThreads);

  return withReactions;
}

function normalizeMessages(messages: any[]): any[] {
  // INEFFICIENCY 3: .map() creating new objects when mutation would suffice
  // Plus redundant string operations
  return messages.map(msg => ({
    ...msg,
    content: msg.content.trim().replace(/\s+/g, ' '),  // Already clean, but normalizes anyway
    authorId: msg.authorId.toLowerCase().trim(),         // Already lowercase
    id: msg.id.toString(),                               // Already a string
  }));
}

function enrichMessages(messages: any[]): ProcessedMessage[] {
  // INEFFICIENCY 4: Resolving author for every message (no lookup cache)
  // Real apps often have a getUser() call that isn't memoized
  return messages.map(msg => {
    const author = resolveAuthor(msg.authorId);      // O(n) lookup each time
    const contentHtml = parseMarkdown(msg.content);  // Regex-heavy, allocates many strings
    const mentions = extractMentions(msg.content);   // Another pass over the same string
    const emojis = decodeEmojis(msg.content);        // Yet another pass

    return {
      ...msg,
      author,
      contentHtml,
      mentions,
      emojis,
      formattedTime: formatTimestamp(msg.timestamp), // Creates Date object each time
      dateGroup: getDateGroup(msg.timestamp),         // Creates another Date object
      reactionSummary: [],
    };
  });
}

function resolveAuthor(authorId: string): { id: string; name: string; avatar: string } {
  // INEFFICIENCY 5: Linear scan of user list for every message
  // No Map/cache, just Array.find() every time
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
  // Array is re-created on every call too (allocation pressure)
  return users.find(u => u.id === authorId) || { id: authorId, name: 'Unknown', avatar: '??' };
}

function parseMarkdown(content: string): string {
  // INEFFICIENCY 6: Sequential regex replacements, each creating new strings
  // A real app might use a full markdown parser, but this simulates the cost
  let html = content;
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="$1">$2</code></pre>');
  html = html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  html = html.replace(/\n/g, '<br>');

  // INEFFICIENCY 7: Re-process the string to handle line items
  // (could be done in a single pass with the above)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

  return html;
}

function extractMentions(content: string): string[] {
  // INEFFICIENCY 8: Regex + filter + map chain with intermediate arrays
  const matches = content.match(/@user\d+/g) || [];
  return matches
    .map(m => m.slice(1))            // Remove @
    .filter((v, i, a) => a.indexOf(v) === i)  // Dedupe via indexOf (O(n^2))
    .map(userId => resolveAuthor(userId).name);  // Another author lookup per mention!
}

function decodeEmojis(content: string): string[] {
  // INEFFICIENCY 9: Regex matching + lookup table rebuilt on every call
  const emojiMap: Record<string, string> = {
    'thumbsup': '\u{1F44D}', 'heart': '\u2764\uFE0F', 'fire': '\u{1F525}', 'rocket': '\u{1F680}',
    'eyes': '\u{1F440}', 'tada': '\u{1F389}', 'thinking': '\u{1F914}', '100': '\u{1F4AF}',
    'wave': '\u{1F44B}', 'pray': '\u{1F64F}', 'white_check_mark': '\u2705',
  };
  const matches = content.match(/:(\w+):/g) || [];
  return matches.map(m => {
    const name = m.slice(1, -1);
    return emojiMap[name] || m;
  });
}

function formatTimestamp(ts: number): string {
  // INEFFICIENCY 10: Creating Intl.DateTimeFormat on every call
  // (should be cached/shared)
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ts));
}

function getDateGroup(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  // INEFFICIENCY 11: Another Intl.DateTimeFormat created per call
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function sortMessages(messages: ProcessedMessage[]): ProcessedMessage[] {
  // INEFFICIENCY 12: Sort by timestamp (number comparison via string coercion)
  // The classic: a.timestamp - b.timestamp would be faster, but this uses localeCompare
  return [...messages].sort((a, b) =>
    new Date(a.timestamp).toISOString().localeCompare(new Date(b.timestamp).toISOString())
  );
}

function groupByDate(messages: ProcessedMessage[]): ProcessedMessage[] {
  // INEFFICIENCY 13: reduce + spread accumulator pattern (O(n^2) copies)
  return messages.reduce((acc, msg) => {
    return [...acc, msg]; // Spreading the entire accumulator each iteration
  }, [] as ProcessedMessage[]);
}

function nestThreads(messages: ProcessedMessage[]): ProcessedMessage[] {
  // INEFFICIENCY 14: O(n^2) thread nesting -- for each parent, filter all messages
  const parents = messages.filter(m => !m.id.includes('-reply-'));
  return parents.map(parent => {
    if (!parent.id.includes('thread')) return parent;
    const threadId = `thread-${parent.id.split('-msg-')[0]}-${parent.id.split('-msg-')[1]}`;
    // Filter ALL messages for each parent (should build a Map once)
    const replies = messages.filter(m => m.id.includes('-reply-') && m.id.startsWith(parent.id));
    return { ...parent, threadMessages: replies };
  });
}

function resolveReactions(messages: ProcessedMessage[]): ProcessedMessage[] {
  // INEFFICIENCY 15: For each message, re-resolve all reactor names via resolveAuthor
  return messages.map(msg => {
    if (!msg.reactions || msg.reactions.length === 0) return msg;
    return {
      ...msg,
      reactionSummary: msg.reactions.map(r => ({
        emoji: decodeEmojis(`:${r.emoji}:`)[0] || r.emoji,
        count: r.userIds.length,
        names: r.userIds.map(uid => resolveAuthor(uid).name), // Author lookup per reactor
      })),
    };
  });
}

// --- Compose Preview Pipeline ---

export function renderPreview(text: string): string {
  // INEFFICIENCY 21: Full re-parse of everything on every keystroke
  let html = parseMarkdown(text);
  const _mentions = extractMentions(text);
  const _emojis = decodeEmojis(text);

  // INEFFICIENCY 22: Synthetic link unfurl simulation
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlRegex) || [];
  const unfurls: string[] = [];

  for (const url of urls) {
    const urlMetadata: Record<string, { title: string; desc: string }> = {
      'https://example.com': { title: 'Example Domain', desc: 'This domain is for use in illustrative examples.' },
      'https://github.com': { title: 'GitHub', desc: 'Where the world builds software.' },
      'https://docs.example.com': { title: 'Documentation', desc: 'Read the docs for more information.' },
      'https://api.example.com': { title: 'API Reference', desc: 'Complete API documentation and guides.' },
      'https://blog.example.com': { title: 'Engineering Blog', desc: 'Technical articles from the team.' },
    };

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

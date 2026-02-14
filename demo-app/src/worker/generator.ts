import type { RawMessage } from '../types';

const USERS = [
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

const EMOJI_NAMES = ['thumbsup', 'heart', 'fire', 'rocket', 'eyes', 'tada', 'thinking', '100', 'wave', 'pray'];

export function generateMessages(channelId: string, count: number, hasThreads: boolean): RawMessage[] {
  const messages: RawMessage[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const author = USERS[i % USERS.length];
    const hasThread = hasThreads && i % 7 === 0;

    messages.push({
      id: `${channelId}-msg-${i}`,
      authorId: author.id,
      content: generateMessageContent(i, channelId),
      timestamp: now - (count - i) * 60000,
      threadId: hasThread ? `thread-${channelId}-${i}` : undefined,
      reactions: generateReactions(i),
      attachments: i % 13 === 0 ? [{ type: 'image', url: `/img/${i}.png`, size: 245000 }] : [],
    });

    if (hasThread) {
      const replyCount = 3 + (i % 5);
      for (let r = 0; r < replyCount; r++) {
        messages.push({
          id: `${channelId}-msg-${i}-reply-${r}`,
          authorId: USERS[(i + r + 1) % USERS.length].id,
          content: generateMessageContent(i * 100 + r, channelId),
          timestamp: now - (count - i) * 60000 + (r + 1) * 30000,
          threadId: `thread-${channelId}-${i}`,
          reactions: r % 3 === 0 ? generateReactions(r) : [],
          attachments: [],
        });
      }
    }
  }
  return messages;
}

function generateMessageContent(seed: number, channelId: string): string {
  const templates = [
    `Hey @user${seed % 20}, check out this **update** to the ${channelId} workflow :rocket:`,
    `I think we should reconsider the approach here. See https://example.com/doc/${seed} for details :thinking:`,
    `@user${(seed + 3) % 20} @user${(seed + 7) % 20} can you review this?\n\n\`\`\`javascript\nconst result = processData(${seed});\nconsole.log(result);\n\`\`\``,
    `:thumbsup: Looks good to me! Ship it :rocket: :tada:`,
    `Here's the summary:\n- Item 1: completed :white_check_mark:\n- Item 2: in progress\n- Item 3: blocked by @user${seed % 20}`,
  ];
  return templates[seed % templates.length];
}

function generateReactions(seed: number): RawMessage['reactions'] {
  if (seed % 4 !== 0) return [];
  const count = 1 + (seed % 3);
  return Array.from({ length: count }, (_, i) => ({
    emoji: EMOJI_NAMES[(seed + i) % EMOJI_NAMES.length],
    userIds: Array.from({ length: 1 + (seed % 5) }, (_, j) => `u${(seed + j) % 20}`),
  }));
}

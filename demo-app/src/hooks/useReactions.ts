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

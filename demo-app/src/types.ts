export interface Channel {
  id: string;
  name: string;
  messageCount: number;
  hasThreads: boolean;
  category: 'small' | 'medium' | 'large' | 'huge';
}

export interface RawMessage {
  id: string;
  authorId: string;
  content: string;
  timestamp: number;
  threadId?: string;
  reactions: { emoji: string; userIds: string[] }[];
  attachments: { type: string; url: string; size: number }[];
}

export interface ProcessedMessage {
  id: string;
  author: { id: string; name: string; avatar: string };
  contentHtml: string;
  mentions: string[];
  emojis: string[];
  timestamp: number;
  formattedTime: string;
  dateGroup: string;
  threadMessages?: ProcessedMessage[];
  reactionSummary: { emoji: string; count: number; names: string[] }[];
  reactions?: { emoji: string; userIds: string[] }[];
}

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

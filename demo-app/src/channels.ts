import type { Channel } from './types';

export const CHANNELS: Channel[] = [
  { id: 'general',       name: 'General',        messageCount: 50,   hasThreads: false, category: 'small' },
  { id: 'random',        name: 'Random',         messageCount: 80,   hasThreads: false, category: 'small' },
  { id: 'introductions', name: 'Introductions',  messageCount: 30,   hasThreads: false, category: 'small' },
  { id: 'engineering',   name: 'Engineering',     messageCount: 500,  hasThreads: true,  category: 'medium' },
  { id: 'design',        name: 'Design',          messageCount: 400,  hasThreads: true,  category: 'medium' },
  { id: 'product',       name: 'Product',         messageCount: 350,  hasThreads: false, category: 'medium' },
  { id: 'standup',       name: 'Standup',         messageCount: 200,  hasThreads: false, category: 'medium' },
  { id: 'frontend',      name: 'Frontend',        messageCount: 600,  hasThreads: true,  category: 'medium' },
  { id: 'backend',       name: 'Backend',         messageCount: 450,  hasThreads: true,  category: 'medium' },
  { id: 'support',       name: 'Support',         messageCount: 2000, hasThreads: true,  category: 'large' },
  { id: 'incidents',     name: 'Incidents',       messageCount: 1500, hasThreads: true,  category: 'large' },
  { id: 'design-review', name: 'Design Review',   messageCount: 3000, hasThreads: true,  category: 'large' },
  { id: 'all-hands',     name: 'All Hands',       messageCount: 5000, hasThreads: true,  category: 'huge' },
  { id: 'announcements', name: 'Announcements',   messageCount: 4000, hasThreads: true,  category: 'huge' },
  { id: 'firehose',      name: 'Firehose',        messageCount: 5000, hasThreads: false, category: 'huge' },
];

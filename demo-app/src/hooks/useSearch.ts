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

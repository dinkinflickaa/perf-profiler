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

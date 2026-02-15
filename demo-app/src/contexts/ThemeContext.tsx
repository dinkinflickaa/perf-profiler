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

    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-density', density);

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

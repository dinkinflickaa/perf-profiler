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

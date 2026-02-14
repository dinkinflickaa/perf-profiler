import type { Channel } from '../types';

interface Props {
  channels: Channel[];
  selected: Channel;
  onSelect: (channel: Channel) => void;
}

export function ChannelList({ channels, selected, onSelect }: Props) {
  return (
    <nav className="channel-list" role="tree">
      <h2>Channels</h2>
      {channels.map(channel => (
        <button
          key={channel.id}
          role="treeitem"
          aria-selected={channel.id === selected.id}
          className={channel.id === selected.id ? 'active' : ''}
          onClick={() => onSelect(channel)}
        >
          <span className="channel-name"># {channel.name}</span>
          <span className="channel-count">{channel.messageCount}</span>
        </button>
      ))}
    </nav>
  );
}

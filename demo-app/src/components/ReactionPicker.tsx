import { REACTION_EMOJIS } from '../hooks/useReactions';

interface Props {
  messageId: string;
  onReact: (messageId: string, emojiName: string) => void;
}

export function ReactionPicker({ messageId, onReact }: Props) {
  return (
    <div className="reaction-picker">
      {REACTION_EMOJIS.map(({ name, emoji }) => (
        <button
          key={name}
          className="reaction-picker-btn"
          onClick={(e) => {
            e.stopPropagation();
            onReact(messageId, name);
          }}
          title={name}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

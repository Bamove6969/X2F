import { Icon } from './icons.js';
import './ui.css';

// The violet shield and "X2F Moderator" from the DisputeRoom board. Violet is used for nothing else.
export function ModeratorBadge() {
  return (
    <span className="x2f-moderator-badge">
      <Icon name="shield" size={12} stroke={2} />
      X2F Moderator
    </span>
  );
}

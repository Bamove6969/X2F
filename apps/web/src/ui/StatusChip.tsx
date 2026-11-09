import { Icon, type IconName } from './icons.js';
import './ui.css';

/**
 * A state colour always comes with a word and an icon (design-system README), so `label` is
 * required. The six tones of the design kit handoff 4.2: `neutral` is refunded or cancelled, `mod`
 * a moderator's decision, `team` a new team member. Never orange.
 */
export type Tone = 'caution' | 'escrow' | 'danger' | 'neutral' | 'mod' | 'team';

// From the trade-room boards (TradeFund "Waiting for you to fund", Desktop "Escrow secured").
export function StatusChip({ tone, icon, label }: { tone: Tone; icon: IconName; label: string }) {
  return (
    <span className="x2f-chip" data-tone={tone}>
      <Icon name={icon} size={16} stroke={1.75} />
      {label}
    </span>
  );
}

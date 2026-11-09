import { Icon, type IconName } from './icons.js';
import './ui.css';

/**
 * A state colour always comes with a word and an icon (design-system README), so `label` is
 * required. The six tones of the design kit handoff 4.2: `neutral` is refunded or cancelled, `mod`
 * a moderator's decision, `team` a new team member; `muted` (results) a finished state that is neither
 * good nor bad. Never orange.
 */
export type Tone = 'caution' | 'escrow' | 'danger' | 'muted' | 'neutral' | 'mod' | 'team';

// From the trade-room boards (TradeFund "Waiting for you to fund", Desktop "Escrow secured").
// `look="tint"` is the hero's chip (visual system v2, section 7): a 28 px pill with a 14% wash of the tone.
export function StatusChip({ tone, icon, label, look }: { tone: Tone; icon: IconName; label: string; look?: 'tint' }) {
  return (
    <span className="x2f-chip" data-tone={tone} data-look={look}>
      <Icon name={icon} size={16} stroke={1.75} />
      {label}
    </span>
  );
}

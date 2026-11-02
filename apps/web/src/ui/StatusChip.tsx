import { Icon, type IconName } from './icons.js';
import './ui.css';

/** A state colour always comes with a word and an icon (design-system README), so `label` is required. */
export type Tone = 'caution' | 'escrow' | 'danger' | 'muted';

// From the trade-room boards (TradeFund "Waiting for you to fund", Desktop "Escrow secured").
export function StatusChip({ tone, icon, label }: { tone: Tone; icon: IconName; label: string }) {
  return (
    <span className="x2f-chip" data-tone={tone}>
      <Icon name={icon} size={16} />
      {label}
    </span>
  );
}

import { Icon, type IconName } from './icons.js';
import './ui.css';

// Profile badges on offer cards (SellOffers board): escrow tone for milestones and honours,
// caution tone for the New safety badge.
export function BadgePill({ tone, icon, label }: { tone: 'escrow' | 'caution'; icon: IconName; label: string }) {
  return (
    <span className="x2f-badge" data-tone={tone}>
      <Icon name={icon} size={12} stroke={2} />
      {label}
    </span>
  );
}

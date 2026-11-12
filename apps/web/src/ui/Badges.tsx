// Badge seal, chip, "+N", row, phone sheet and desktop hover card from the design kit handoff
// (8 Nov 2026) §3, with the head designer's rulings 1 (Trusted is 200+), 4 (the card is a dialog
// with a body-text label) and 5 (the 28 px seal). The badge names and meanings are the kit's draft
// copy (COPY-UNSIGNED). Sizes and tones live in kit.css.
import { useEffect, useId, useRef, useState } from 'react';
import { KitGlyph, type KitGlyphName } from './kitGlyphs.js';
import { Sheet } from './Sheet.js';
import './kit.css';

export type BadgeTone = 'escrow' | 'caution' | 'ink' | 'ink-muted';

export interface BadgeDef {
  key: string;
  name: string;
  tone: BadgeTone;
  /** A stroke glyph, or for milestones the number drawn in mono. */
  glyph: KitGlyphName | { num: string; num40?: string };
  meaning: string;
}

const milestone = (n: number, num = String(n), num40?: string): BadgeDef => {
  const count = n.toLocaleString('en-US');
  return { key: `m${n}`, name: `${count} trades`, tone: 'ink', glyph: num40 ? { num, num40 } : { num }, meaning: `Completed ${count} trades.` };
};

/** The kit's badge set (3.1). Families: reputation escrow, speed caution, security and milestones ink; New is its own grey (neutral) family (design ruling 8 Nov). */
export const BADGE_SET = {
  trusted: { key: 'trusted', name: 'Trusted', tone: 'escrow', glyph: 'trusted', meaning: '200+ trades and 98%+ positive.' },
  clean: { key: 'clean', name: 'Clean record', tone: 'escrow', glyph: 'clean', meaning: 'No lost disputes in 100 trades.' },
  veteran: { key: 'veteran', name: 'Veteran', tone: 'escrow', glyph: 'veteran', meaning: 'Trading on X2F for over a year.' },
  // COPY-UNSIGNED: Fast's meaning under R-042 (owner p11-20: 30 payments in under half the time to pay; design words it).
  fast: { key: 'fast', name: 'Fast', tone: 'caution', glyph: 'fast', meaning: 'Paid in under half the time allowed, 30+ times.' },
  pgp: { key: 'pgp', name: 'PGP verified', tone: 'ink', glyph: 'pgp', meaning: 'Logs in with a verified PGP key.' },
  hw: { key: 'hw', name: 'Security key', tone: 'ink', glyph: 'hw', meaning: 'Protects the account with a hardware key.' },
  m10: milestone(10),
  m50: milestone(50),
  m100: milestone(100),
  m500: milestone(500),
  // Design ruling 8 Nov: "1k" in the 22 and 28 px seals, "1,000" at 40.
  m1000: milestone(1000, '1k', '1,000'),
  new: { key: 'new', name: 'New', tone: 'ink-muted', glyph: 'sprout', meaning: 'Joined in the last 30 days.' },
} as const satisfies Record<string, BadgeDef>;

export type BadgeKey = keyof typeof BADGE_SET;

/** API badge ids (spec 5.4) to the kit's set; ids the app does not know are left off (null). */
export function badgeFromApi(id: string): BadgeDef | null {
  const alias: Record<string, BadgeKey> = { 'security-key': 'hw', 'clean-record': 'clean' };
  const m = /^trades-(\d+)$/.exec(id);
  const key = (m ? `m${m[1]}` : (alias[id] ?? id)) as BadgeKey;
  return Object.hasOwn(BADGE_SET, key) ? BADGE_SET[key] : null;
}

export type SealSize = 22 | 28 | 40;
const GLYPH: Record<SealSize, number> = { 22: 13, 28: 16, 40: 20 };

/** The badge seal (3.2): a 16% tone wash with a 55% ring. Always `aria-hidden`; the text next to it names the badge. */
export function BadgeSeal({ badge, size = 40 }: { badge: BadgeDef; size?: SealSize }) {
  return (
    <span className="x2f-seal" data-size={size} data-tone={badge.tone} aria-hidden="true">
      {typeof badge.glyph === 'string' ? <KitGlyph name={badge.glyph} size={GLYPH[size]} /> : <span className="x2f-seal__num">{size === 40 ? (badge.glyph.num40 ?? badge.glyph.num) : badge.glyph.num}</span>}
    </span>
  );
}

/** "Trusted badge: 200+ trades and 98%+ positive." */
export const chipLabel = (b: BadgeDef) => `${b.name} badge: ${b.meaning}`;

/** A badge chip (3.3): the 30 px pill inside a 44 px transparent button. */
export function BadgeChip({ badge, onOpen }: { badge: BadgeDef; onOpen?: (trigger: HTMLButtonElement) => void }) {
  return (
    <button type="button" className="x2f-chip-k" aria-haspopup="dialog" aria-label={chipLabel(badge)} onClick={(e) => onOpen?.(e.currentTarget)}>
      <span className="x2f-chip-k__pill" data-tone={badge.tone}>
        <BadgeSeal badge={badge} size={22} />
        {badge.name}
      </span>
    </button>
  );
}

/** One badge in a list (3.5): the 40 seal, the name, the meaning and an optional earned line ("Earned <mono>12 Mar 2026</mono>"). */
export function BadgeRow({ badge, earned }: { badge: BadgeDef; earned?: { pre: string; date: string } }) {
  return (
    <li className="x2f-badge-row">
      <BadgeSeal badge={badge} size={40} />
      <span className="x2f-badge-row__text">
        <span className="x2f-badge-row__name">{badge.name}</span>
        <span className="x2f-badge-row__meaning">{badge.meaning}</span>
        {earned ? (
          <span className="x2f-badge-row__earned">
            {earned.pre} <span className="x2f-digits">{earned.date}</span>
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** The phone badge sheet (3.6): "<name>'s badges" over every visible badge. Closes on the X, the scrim, Esc or a swipe down. */
export function BadgeSheet({ open, name, badges, onClose }: { open: boolean; name: string; badges: readonly BadgeDef[]; onClose: () => void }) {
  return (
    <Sheet open={open} title={`${name}'s badges`} handle onClose={onClose}>
      <ul className="x2f-badge-list" data-part="badge-sheet-list">
        {badges.map((b) => (
          <BadgeRow key={b.key} badge={b} />
        ))}
      </ul>
    </Sheet>
  );
}

/**
 * The desktop hover card (3.7, ruling 4): a dialog named "<name>'s other badges" under the "+N"
 * button, with "3 more badges" as body text (the digit in mono) over the list.
 */
export function BadgeCard({ id, name, badges, onLeave, onPointerEnter }: { id: string; name: string; badges: readonly BadgeDef[]; onLeave?: () => void; onPointerEnter?: () => void }) {
  return (
    <div id={id} className="x2f-badge-card" role="dialog" aria-label={`${name}'s other badges`} onPointerLeave={onLeave} onPointerEnter={onPointerEnter}>
      <span className="x2f-badge-card__label">
        <span className="x2f-digits">{badges.length}</span> more {badges.length === 1 ? 'badge' : 'badges'}
      </span>
      <ul className="x2f-badge-list" data-gap="14">
        {badges.map((b) => (
          <BadgeRow key={b.key} badge={b} />
        ))}
      </ul>
    </div>
  );
}

/** Desktop: a mouse or trackpad that can hover. Phones and tablets get the sheet. */
function canHover(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** Featured badges on a card (spec 5.4): at most 2, the rest behind "+N". */
export const FEATURED = 2;

/**
 * The chip row (kit 2.6.3, 3.3-3.8): up to two featured chips, then "+N". Any chip opens the badge
 * sheet. "+N" opens the sheet on a phone; on a desktop pointing at it (or Enter) opens the hover
 * card, which stays open while the pointer is over the button or the card and closes on Esc or when
 * the pointer leaves both. Focus returns to the button on close.
 */
export function BadgeChips({ name, badges, featured = FEATURED }: { name: string; badges: readonly BadgeDef[]; featured?: number }) {
  const [open, setOpen] = useState<'sheet' | 'card' | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardId = useId();
  const shown = badges.slice(0, featured);
  const rest = badges.slice(featured);

  const cancelLeave = () => {
    if (leave.current !== null) clearTimeout(leave.current);
    leave.current = null;
  };
  // Leaving the button for the card (or back) is not leaving: wait a moment before closing.
  const scheduleLeave = () => {
    cancelLeave();
    leave.current = setTimeout(() => setOpen((o) => (o === 'card' ? null : o)), 150);
  };
  useEffect(() => cancelLeave, []);

  useEffect(() => {
    if (open !== 'card') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(null);
      more.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (badges.length === 0) return null;
  return (
    <div className="x2f-chip-row" data-part="badge-chips">
      {shown.map((b) => (
        <BadgeChip key={b.key} badge={b} onOpen={() => setOpen('sheet')} />
      ))}
      {rest.length > 0 ? (
        <span className="x2f-chip-row__more">
          <button
            ref={more}
            type="button"
            className="x2f-chip-k"
            aria-haspopup="dialog"
            aria-expanded={open !== null}
            aria-controls={open === 'card' ? cardId : undefined}
            aria-label={`${rest.length} more ${rest.length === 1 ? 'badge' : 'badges'}`}
            onPointerEnter={(e) => {
              if (e.pointerType !== 'mouse' || !canHover()) return;
              cancelLeave();
              setOpen('card');
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') scheduleLeave();
            }}
            onClick={() => setOpen((o) => (o !== null ? null : canHover() ? 'card' : 'sheet'))}
          >
            <span className="x2f-more-k" data-open={open !== null ? 'true' : undefined}>
              <span className="x2f-digits">+{rest.length}</span>
              <KitGlyph name="chevron-down" size={14} stroke={2} />
            </span>
          </button>
          {open === 'card' ? <BadgeCard id={cardId} name={name} badges={rest} onPointerEnter={cancelLeave} onLeave={scheduleLeave} /> : null}
        </span>
      ) : null}
      <BadgeSheet open={open === 'sheet'} name={name} badges={badges} onClose={() => setOpen(null)} />
    </div>
  );
}

/** For callers that build the row from API ids. */
export function badgesFromApi(ids: readonly string[]): BadgeDef[] {
  return ids.flatMap((id) => {
    const b = badgeFromApi(id);
    return b ? [b] : [];
  });
}

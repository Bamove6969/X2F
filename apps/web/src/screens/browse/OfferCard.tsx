import { useState } from 'react';
import { BadgePill } from '../../ui/BadgePill.js';
import { Button } from '../../ui/Button.js';
import { Icon, type IconName } from '../../ui/icons.js';
import { formatMinor, type Offer, type OpensAt } from './api.js';
import type { BrowseCopy } from './SellCopy.js';
import './browse.css';

// One offer card from the SellOffers board. What the card may offer comes from the API only:
// `opensAt` (the viewer's starter limits, spec 2.3) greys the card and removes the take control,
// and `poster.stage` decides the amber New badge. The card never works out a stage from trade
// counts or dates.

interface BadgeInfo {
  label: string;
  icon: IconName;
  tone: 'escrow' | 'caution';
  meaning: string;
}

const NEW_BADGE: BadgeInfo = { label: 'New', icon: 'sprout', tone: 'caution', meaning: 'new to X2F, still on starter limits' };

/** Earned badges by API id (spec 5.4). Ids the app does not know are left off. */
const BADGES: Record<string, BadgeInfo> = {
  trusted: { label: 'Trusted', icon: 'shield-check', tone: 'escrow', meaning: '100+ trades, 98%+ positive' },
  fast: { label: 'Fast', icon: 'bolt', tone: 'escrow', meaning: 'usually pays or releases within 10 min' },
  veteran: { label: 'Veteran', icon: 'star', tone: 'escrow', meaning: 'trading on X2F for 1+ year' },
  pgp: { label: 'PGP verified', icon: 'pgp-key', tone: 'escrow', meaning: 'signs in with a verified PGP key' },
  'security-key': { label: 'Security key verified', icon: 'security-key', tone: 'escrow', meaning: 'protects the account with a hardware key' },
  'clean-record': { label: 'Clean record', icon: 'shield', tone: 'escrow', meaning: '100 trades with no lost disputes' },
  ...Object.fromEntries(
    [10, 50, 100, 500, 1000].map((n) => {
      const count = n.toLocaleString('en-US');
      return [`trades-${n}`, { label: `${count} trades`, icon: 'check', tone: 'escrow', meaning: `${count}+ completed trades` } satisfies BadgeInfo];
    }),
  ),
};

/** Featured badges on a card (spec 5.4): at most 2; the rest are behind "+N". */
const FEATURED = 2;

/** The poster's badges in order: New first while the API says they are not Graduated (it is always featured). */
function badgesOf(offer: Offer): BadgeInfo[] {
  const earned = offer.poster.badges.filter((id) => id !== 'new').flatMap((id) => (BADGES[id] ? [BADGES[id]] : []));
  return offer.poster.stage === 'graduated' ? earned : [NEW_BADGE, ...earned];
}

const STAGE_NAME: Record<OpensAt, string> = { building: 'Building', graduated: 'Graduated' };

function seen(lastSeenAt: string | null, now: Date): string {
  if (lastSeenAt === null) return 'Offline';
  const min = Math.max(0, Math.floor((now.getTime() - Date.parse(lastSeenAt)) / 60_000));
  if (!Number.isFinite(min)) return 'Offline';
  if (min < 1) return 'Seen just now';
  if (min < 60) return `Seen ${min} min ago`;
  if (min < 48 * 60) return `Seen ${Math.floor(min / 60)} h ago`;
  return `Seen ${Math.floor(min / (24 * 60))} d ago`;
}

function posterLine(offer: Offer, now: Date): string {
  const p = offer.poster;
  const parts = [p.online ? 'Online' : seen(p.lastSeenAt, now), `${p.completedTrades} ${p.completedTrades === 1 ? 'trade' : 'trades'}`];
  if (p.positivePct !== null) parts.push(`${p.positivePct}% positive`);
  return parts.join(' · ');
}

function marginLine(offer: Offer, copy: BrowseCopy): { text: string; favourable: boolean } | null {
  if (offer.rate === null) return null;
  if (offer.pricing.mode === 'fixed') return { text: 'Fixed price', favourable: false };
  const bps = offer.pricing.marginBps;
  if (bps === 0) return { text: 'At market', favourable: false };
  const pct = (Math.abs(bps) / 100).toFixed(2).replace(/\.?0+$/, '');
  return { text: `${pct}% ${bps > 0 ? 'above' : 'below'} market`, favourable: copy.favourable(bps) };
}

function Badges({ offer }: { offer: Offer }) {
  // A tap or click pins the list open (and closes it again); a mouse hovering also shows it. Touch
  // pointers are left out of hover, so a tap is not an open (hover) and a close (click) at once.
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const open = pinned || hover;
  const all = badgesOf(offer);
  if (all.length === 0) return null;
  const featured = all.slice(0, FEATURED);
  const more = all.length - featured.length;
  return (
    <span className="x2f-offer__badges">
      {featured.map((b) => (
        <BadgePill key={b.label} tone={b.tone} icon={b.icon} label={b.label} />
      ))}
      {more > 0 ? (
        <>
          <button
            type="button"
            className="x2f-offer__more"
            aria-label={`Show all ${all.length} badges`}
            aria-expanded={open}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse') setHover(true);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setHover(false);
            }}
            onClick={() => setPinned((p) => !p)}
          >
            +{more}
          </button>
          {open ? (
            <span role="tooltip" className="x2f-offer__tip">
              <span className="x2f-offer__tip-title">
                All of <span data-username>{offer.poster.username}</span>'s badges
              </span>
              {all.map((b) => (
                <span key={b.label}>
                  <strong data-tone={b.tone}>{b.label}</strong> · {b.meaning}
                </span>
              ))}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

export interface OfferCardProps {
  offer: Offer;
  currency: string;
  copy: BrowseCopy;
  /** The one orange Trade on the screen (the first offer that can be taken). */
  primary: boolean;
  now: Date;
  onTrade?: (offer: Offer) => void;
  onMessage?: (offer: Offer) => void;
  onNudge?: (offer: Offer) => void;
}

export function OfferCard({ offer, currency, copy, primary, now, onTrade, onMessage, onNudge }: OfferCardProps) {
  const name = offer.poster.username;
  const closed = offer.opensAt !== undefined;
  const margin = marginLine(offer, copy);
  const range = `${formatMinor(offer.minFiatCents, currency, { whole: true })} – ${formatMinor(offer.maxFiatCents, currency, { whole: true })}`;
  const time = offer.poster.typicalMinutes === null ? null : copy.typicalTime(offer.poster.typicalMinutes);

  let action;
  if (offer.opensAt !== undefined) {
    action = <span className="x2f-offer__opens">Opens at {STAGE_NAME[offer.opensAt]}</span>;
  } else if (offer.poster.online) {
    action = (
      <Button variant={primary ? 'primary' : 'secondary'} className="x2f-offer__action" aria-label={`Trade with ${name}`} onClick={() => onTrade?.(offer)}>
        Trade
      </Button>
    );
  } else {
    action = (
      <Button variant="secondary" className="x2f-offer__action" onClick={() => onMessage?.(offer)}>
        Message {name}
      </Button>
    );
  }

  return (
    <article className="x2f-offer" data-opens-at={offer.opensAt} aria-disabled={closed ? 'true' : undefined}>
      <div className="x2f-offer__top">
        <div className="x2f-offer__who">
          <span className="x2f-offer__name">
            <span className="x2f-offer__dot" data-online={offer.poster.online} aria-hidden="true" />
            <span data-username>{name}</span>
          </span>
          <span className="x2f-offer__sub">{posterLine(offer, now)}</span>
          <Badges offer={offer} />
        </div>
        {!closed && !offer.poster.online ? (
          <button type="button" className="x2f-offer__nudge" aria-label={`Nudge ${name}`} onClick={() => onNudge?.(offer)}>
            <Icon name="bell" size={14} />
            Nudge
          </button>
        ) : null}
      </div>
      <div className="x2f-offer__terms">
        <div className="x2f-offer__price">
          <span className="x2f-offer__rate" data-part="rate">
            {offer.rate === null ? 'Price unavailable right now' : formatMinor(offer.rate, currency)}
          </span>
          {margin ? (
            <span className="x2f-offer__margin" data-tone={margin.favourable ? 'escrow' : undefined}>
              {margin.text}
            </span>
          ) : null}
        </div>
        <span className="x2f-offer__limits">
          {range}
          {time === null ? null : (
            <>
              <br />
              {time}
            </>
          )}
        </span>
      </div>
      {action}
    </article>
  );
}

import { useState, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router';
import { BadgePill } from '../../ui/BadgePill.js';
import { Button } from '../../ui/Button.js';
import { Icon, type IconName } from '../../ui/icons.js';
import { marginParts, type MarginParts } from '../../ui/margin.js';
import { PickButton } from '../../ui/PickButton.js';
import { formatMinor, type Offer, type OpensAt } from './api.js';
import { cardRows, type RangeRows } from './offerAmounts.js';
import { NEW_BADGE, tradesWord, type BadgeInfo } from './posterCopy.js';
import type { BrowseCopy } from './SellCopy.js';
import './browse.css';

// One offer card from the SellOffers and BuyOffers boards. What the card may offer comes from the API only:
// `opensAt` (the viewer's starter limits, spec 2.3) greys the card and removes the take control,
// and `poster.stage` decides the amber New badge. The card never works out a stage from trade
// counts or dates.

// NEW_BADGE and the trade count's word live in posterCopy.ts (the sign-up's trader card preview shows them too).

/** Earned badges by API id (spec 5.4). Ids the app does not know are left off. */
const BADGES: Record<string, BadgeInfo> = {
  trusted: { label: 'Trusted', icon: 'shield-check', tone: 'escrow', meaning: '200+ trades and 98%+ positive' },
  // COPY-UNSIGNED: Fast's meaning under R-042 (owner p11-20), the same words as @x2f/reputation BADGES.fast (review n3).
  fast: { label: 'Fast', icon: 'bolt', tone: 'escrow', meaning: 'Paid in under half the time allowed, 30+ times' },
  veteran: { label: 'Veteran', icon: 'star', tone: 'escrow', meaning: 'trading on X2F for 1+ year' },
  // The ids the API earns them under (@x2f/reputation badges.ts); COPY-UNSIGNED: the 3- and 5-year labels (P5-A12).
  'veteran-1': { label: 'Veteran', icon: 'star', tone: 'escrow', meaning: 'trading on X2F for 1+ year' },
  'veteran-3': { label: 'Veteran · 3 years', icon: 'star', tone: 'escrow', meaning: 'trading on X2F for 3+ years' },
  'veteran-5': { label: 'Veteran · 5 years', icon: 'star', tone: 'escrow', meaning: 'trading on X2F for 5+ years' },
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

/**
 * Featured badges on a card (spec 5.4): at most 2; the rest are behind "+N". The trader chooses
 * which (Plan 5 Task 5): the API sends how many of its list are Featured, New included.
 */
const FEATURED = 2;

function featuredOf(offer: Offer): number {
  const n = offer.poster.featuredBadges;
  return n === undefined || !Number.isInteger(n) || n < 0 ? FEATURED : Math.min(n, FEATURED);
}

/** The poster's name, linking to their profile (Plan 5 Task 12) wherever the card is in the app's router. */
function PosterName({ name }: { name: string }) {
  const routed = useInRouterContext();
  if (!routed) return <span data-username>{name}</span>;
  return (
    <Link className="x2f-offer__profile" to={`/u/${encodeURIComponent(name)}`} data-username>
      {name}
    </Link>
  );
}

/** The poster's badges in order: New first while the API says they are not Graduated (it is always featured). */
function badgesOf(offer: Offer): BadgeInfo[] {
  const earned = offer.poster.badges.filter((id) => id !== 'new').flatMap((id) => (BADGES[id] ? [BADGES[id]] : []));
  return offer.poster.stage === 'graduated' ? earned : [NEW_BADGE, ...earned];
}

const STAGE_NAME: Record<OpensAt, string> = { building: 'Building', graduated: 'Graduated' };

/** A figure in the meta line: mono ink (kit 2.7, `mono_digits`). */
const Num = ({ children }: { children: ReactNode }) => (
  <span className="x2f-offer__num" data-part="num">
    {children}
  </span>
);

function seen(lastSeenAt: string | null, now: Date): ReactNode {
  if (lastSeenAt === null) return 'Offline';
  const min = Math.max(0, Math.floor((now.getTime() - Date.parse(lastSeenAt)) / 60_000));
  if (!Number.isFinite(min)) return 'Offline';
  if (min < 1) return 'Seen just now';
  if (min < 60) return <>Seen <Num>{min}</Num> min ago</>;
  if (min < 48 * 60) return <>Seen <Num>{Math.floor(min / 60)}</Num> h ago</>;
  return <>Seen <Num>{Math.floor(min / (24 * 60))}</Num> d ago</>;
}

/**
 * The trust row's meta line (boards SellOffers/BuyOffers, kit 2.7): "Online · 212 trades · 99%
 * positive", Online in the escrow tone and every number in mono. The figures are the API's own
 * (completed trades, % positive from reviews); no % positive until a rated review exists.
 */
function posterLine(offer: Offer, now: Date): ReactNode {
  const p = offer.poster;
  const parts: ReactNode[] = [
    p.online ? (
      <span key="seen" className="x2f-offer__online" data-part="online">
        Online
      </span>
    ) : (
      <span key="seen">{seen(p.lastSeenAt, now)}</span>
    ),
    <span key="trades">
      <Num>{p.completedTrades.toLocaleString('en-US')}</Num> {tradesWord(p.completedTrades)}
    </span>,
  ];
  if (p.positivePct !== null) {
    parts.push(
      <span key="pct">
        <Num>{p.positivePct}%</Num> positive
      </span>,
    );
  }
  return parts.flatMap((part, i) => (i === 0 ? [part] : [' · ', part]));
}

/**
 * Owner Q63 (6 Nov): the trader's opt-in volume line, in XMR. X is a step the trader has traded MORE
 * than (owner 2026-11-03). Owner Q64/p4-1: one more line per site with verified imported volume, in
 * US dollars ("$X+ on <site>, verified"). COPY-UNSIGNED, DESIGNER-REVIEW (design words "the XMR line").
 */
function tradedLine(xmr: number): string {
  return `${xmr.toLocaleString('en-US')}+ XMR traded to date`;
}

function importedLine(l: { site: string; overUsd: number }): string {
  return `$${l.overUsd.toLocaleString('en-US')}+ on ${l.site}, verified`;
}

/**
 * The price against the market at the card's bottom left (owner #11, 8 Nov; boards v142): the
 * figure in mono over its words, "0.4%" over "above market", "at market" alone when there is no
 * margin; the one wording everywhere (design final call 10 Nov 2026, ui/margin.ts; it replaces
 * "+0.4%" over "Vendor markup"). Every offer is the market +/- % (owner Q1: no fixed-price offers).
 * Null while the offer has no price (the feed is down). COPY-UNSIGNED (ui/margin.ts).
 */
export interface Markup extends MarginParts {
  favourable: boolean;
}

export function markupOf(offer: Pick<Offer, 'rate' | 'pricing'>, copy: Pick<BrowseCopy, 'favourable'>): Markup | null {
  if (offer.rate === null) return null;
  const bps = offer.pricing.marginBps;
  return { ...marginParts(bps), favourable: bps !== 0 && copy.favourable(bps) };
}

function Badges({ offer }: { offer: Offer }) {
  // A tap or click pins the list open (and closes it again); a mouse hovering also shows it. Touch
  // pointers are left out of hover, so a tap is not an open (hover) and a close (click) at once.
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const open = pinned || hover;
  const all = badgesOf(offer);
  if (all.length === 0) return null;
  const featured = all.slice(0, featuredOf(offer));
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
                All of <span data-username>{offer.poster.tradeTag}</span>'s badges
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
  /** The market price now (minor units per XMR), for the range shown without the markup; null when unknown. */
  market?: bigint | null;
  /**
   * "Display amounts including vendor markup" (owner, 8 Nov): the range's other unit at the offer's
   * own rate instead of the market price. Off by default.
   */
  withMarkup?: boolean;
  onTrade?: (offer: Offer) => void;
  onMessage?: (offer: Offer) => void;
  onNudge?: (offer: Offer) => void;
  /**
   * Two panes (Fold-Offers): the card is a row that picks the offer whose quote the next pane
   * shows; the quote has the one Trade. An offline poster's card stays as on the phone (Message,
   * Nudge): its offer is not taken from here.
   */
  pick?: { pressed: boolean; onPick: (offer: Offer) => void };
}

/**
 * The range in XMR and in fiat, one row each, right-aligned (owner, 8 Nov; boards v142): the figures in
 * mono, then the unit, "XMR" in Monero ink and the currency code muted. A row with no rate now is left out.
 */
export function RangeRowsView({ rows, currency, className = 'x2f-offer__range' }: { rows: RangeRows; currency: string; className?: string }) {
  return (
    <>
      {rows.xmr !== null ? (
        <span className={className} data-part="range-xmr">
          <span className="x2f-offer__figures">{rows.xmr}</span> <span className="x2f-offer__unit" data-unit="xmr">XMR</span>
        </span>
      ) : null}
      {rows.fiat !== null ? (
        <span className={className} data-part="range-fiat">
          <span className="x2f-offer__figures">{rows.fiat}</span> <span className="x2f-offer__unit">{currency}</span>
        </span>
      ) : null}
    </>
  );
}

export function OfferCard({ offer, currency, copy, primary, now, market = null, withMarkup = false, onTrade, onMessage, onNudge, pick }: OfferCardProps) {
  const name = offer.poster.tradeTag;
  const closed = offer.opensAt !== undefined;
  const markup = markupOf(offer, copy);
  const rows = cardRows(offer, currency, market, withMarkup);
  const time = offer.poster.typicalMinutes === null ? null : copy.typicalTime(offer.poster.typicalMinutes);

  if (pick && (closed || offer.poster.online)) {
    return (
      <PickButton pressed={pick.pressed} onPick={() => pick.onPick(offer)} className="x2f-offer__pick">
        <span className="x2f-offer__pick-line">
          <span className="x2f-offer__name">
            <span className="x2f-offer__dot" data-online={offer.poster.online} aria-hidden="true" />
            <span data-username>{name}</span>
          </span>
          <span className="x2f-offer__rate" data-part="rate">
            {offer.rate === null ? 'Price unavailable right now' : formatMinor(offer.rate, currency)}
          </span>
        </span>
        <span className="x2f-offer__pick-line">
          <span className="x2f-offer__sub">{posterLine(offer, now)}</span>
          <span className="x2f-offer__limits">
            <RangeRowsView rows={rows} currency={currency} />
          </span>
        </span>
        {closed ? <span className="x2f-offer__opens">Opens at {STAGE_NAME[offer.opensAt!]}</span> : null}
      </PickButton>
    );
  }

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
            <PosterName name={name} />
          </span>
          <span className="x2f-offer__sub">{posterLine(offer, now)}</span>
          {offer.poster.tradedOverXmr !== null ? <span className="x2f-offer__sub">{tradedLine(offer.poster.tradedOverXmr)}</span> : null}
          {offer.poster.imported.map((l) => (
            <span key={l.site} className="x2f-offer__sub" data-part="imported-line">
              {importedLine(l)}
            </span>
          ))}
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
          {time === null ? null : <span className="x2f-offer__time">{time}</span>}
        </div>
        <div className="x2f-offer__amounts">
          {markup ? (
            <span className="x2f-offer__markup" data-part="markup">
              {markup.figure !== null ? (
                <>
                  <span className="x2f-offer__margin" data-tone={markup.favourable ? 'escrow' : undefined}>
                    {markup.figure}
                  </span>{' '}
                </>
              ) : null}
              <span className="x2f-offer__markup-label">{markup.words}</span>
            </span>
          ) : (
            <span />
          )}
          <span className="x2f-offer__limits">
            <RangeRowsView rows={rows} currency={currency} />
          </span>
        </div>
      </div>
      {action}
    </article>
  );
}

// Trader identity blocks from the design kit handoff (8 Nov 2026) §2.4-2.8: IdentityRow,
// StatTiles, TraderCard, CompactTrader and RecipientRow. Numbers are mono, words Atkinson.
import { Fragment, type ReactNode } from 'react';
import { Avatar, ModTile, RoleTag, type AvatarSize, type Role } from './Avatar.js';
import { BadgeChips, type BadgeDef } from './Badges.js';
import './kit.css';

/** The kit's digit split (4.3 `monoParts`, plus a trailing % as `mono_digits` does): "1,284 trades" → [mono "1,284", " trades"]. */
const DIGITS = /((?<![A-Za-z])\d(?:[\d.,:]*\d)?%?)/;

/** Text with every number set in mono (kit 1.4: mono is for digits only). */
export function MonoDigits({ text }: { text: string }) {
  return (
    <>
      {text.split(DIGITS).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="x2f-digits">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Who a trader is, as the identity pieces need it. */
export interface TraderIdentity {
  name: string;
  /** Holds the Trusted badge: the avatar's escrow ring. */
  trusted: boolean;
  online: boolean;
  vendor: boolean;
  /** The meta line after "Online · " (or the whole line when offline, e.g. "Last seen 1 h ago"). */
  meta: string;
}

/**
 * The avatar, name and meta line (kit 2.4). Online reads "Online" in escrow 600 before the meta.
 * `mod` draws a moderator: the mod tile instead of the avatar and the name in mod violet.
 */
export function IdentityRow({
  person,
  size = 48,
  on = 'surface',
  role,
  mod = false,
  wrap = false,
}: {
  person: TraderIdentity;
  size?: Extract<AvatarSize, 40 | 48>;
  on?: 'surface' | 'raised';
  /** The role tag after the name; by default Vendor for a vendor, the X2F Moderator tag for a moderator. */
  role?: Role | null;
  mod?: boolean;
  /** Compact rows: the name row wraps with a 2 px row gap. */
  wrap?: boolean;
}) {
  const tag = role === undefined ? (mod ? 'mod' : person.vendor ? 'vendor' : null) : role;
  return (
    <span className="x2f-ident" data-size={size}>
      {mod ? <ModTile size={size} /> : <Avatar name={person.name} size={size} trusted={person.trusted} online={person.online} on={on} />}
      <span className="x2f-ident__text">
        <span className="x2f-ident__name-row" data-wrap={wrap ? 'true' : undefined}>
          <span className="x2f-ident__name" data-mod={mod ? 'true' : undefined} data-username>
            {person.name}
          </span>
          {tag ? <RoleTag role={tag} /> : null}
        </span>
        <span className="x2f-ident__meta">
          {person.online ? (
            <>
              <span className="x2f-ident__online">Online</span>
              {person.meta ? ' · ' : null}
            </>
          ) : null}
          <MonoDigits text={person.meta} />
        </span>
      </span>
    </span>
  );
}

/** Three stat tiles (kit 2.5): value over label, as a description list. */
export function StatTiles({ items }: { items: readonly { value: string; label: string }[] }) {
  return (
    <dl className="x2f-stats">
      {items.map((s) => (
        <div className="x2f-stat" key={s.label}>
          <dt className="x2f-stat__l">{s.label}</dt>
          <dd className="x2f-stat__v">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The trader stats the kit always shows: trades, % positive, XMR traded to date. */
export function traderStats(s: { trades: number; positivePct: number | null; xmrTraded: string | null }): { value: string; label: string }[] {
  return [
    { value: s.trades.toLocaleString('en-US'), label: 'trades' },
    { value: s.positivePct === null ? '–' : `${s.positivePct}%`, label: 'positive' },
    { value: s.xmrTraded ?? '–', label: 'XMR traded' },
  ];
}

/**
 * The trader card (kit 2.6): identity at 48, the three stat tiles, then up to two badge chips and
 * "+N", in a radius-16 surface card named "Seller" or "Buyer". Goes right after the hero on phone.
 */
export function TraderCard({
  label,
  person,
  stats,
  badges,
}: {
  label: string;
  person: TraderIdentity;
  stats: readonly { value: string; label: string }[];
  badges: readonly BadgeDef[];
}) {
  return (
    <section className="x2f-trader-card" aria-label={label}>
      <IdentityRow person={person} size={48} />
      <StatTiles items={stats} />
      <BadgeChips name={person.name} badges={badges} />
    </section>
  );
}

/**
 * The offer-list trader block (kit 2.7): a 40 avatar, the name and Vendor tag (wrapping), one
 * muted meta line with numbers in mono, an optional trailing slot (`side`), then the chip row.
 * Online is the dot plus a visually hidden "Online · " before the meta.
 */
export function CompactTrader({
  person,
  badges,
  muted = false,
  side,
  children,
}: {
  person: TraderIdentity;
  badges: readonly BadgeDef[];
  muted?: boolean;
  side?: ReactNode;
  /** More muted lines under the meta (the opt-in volume lines). */
  children?: ReactNode;
}) {
  return (
    <div className="x2f-compact-trader">
      <div className="x2f-compact-trader__top">
        <Avatar name={person.name} size={40} trusted={person.trusted} online={person.online} />
        <span className="x2f-compact-trader__text">
          <span className="x2f-ident__name-row" data-wrap="true">
            <span className="x2f-ident__name" data-size="40" data-muted={muted ? 'true' : undefined} data-username>
              {person.name}
            </span>
            {person.vendor ? <RoleTag role="vendor" /> : null}
          </span>
          <span className="x2f-ident__meta">
            {person.online ? <span className="x2f-sr-only">Online · </span> : null}
            <MonoDigits text={person.meta} />
          </span>
          {children}
        </span>
        {side}
      </div>
      <BadgeChips name={person.name} badges={badges} />
    </div>
  );
}

/**
 * Who gets the coins, in release and payment-confirm sheets (kit 2.8): the identity row at 48 with
 * no stats or chips, then the amount line indented 60 px so it starts under the name.
 */
export function RecipientRow({ person, xmr, fiat }: { person: TraderIdentity; xmr: string; fiat: string }) {
  return (
    <div className="x2f-recipient">
      <IdentityRow person={person} size={48} />
      <span className="x2f-recipient__amount">
        <span className="x2f-recipient__xmr">
          <span className="x2f-digits">{xmr}</span>
          <span className="x2f-recipient__unit">XMR</span>
        </span>
        <span className="x2f-recipient__fiat">
          about <span className="x2f-digits">{fiat}</span>
        </span>
      </span>
    </div>
  );
}

// @vitest-environment happy-dom
// Design kit handoff (8 Nov 2026) §2 and §3, checked against §19.2's acceptance lines and the head
// designer's rulings (2, 4, 5, 10, 15). Sizes are read from kit.css, behaviour from the DOM.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar, initialsOf, ModTile, RoleTag } from '../src/ui/Avatar.js';
import { BADGE_SET, BadgeCard, BadgeChip, BadgeChips, badgeFromApi, BadgeRow, BadgeSeal, badgesFromApi } from '../src/ui/Badges.js';
import { CompactTrader, IdentityRow, MonoDigits, RecipientRow, StatTiles, TraderCard, traderStats } from '../src/ui/Identity.js';
import { advance, fire, key, render } from './render.js';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/ui/kit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
  if (m === null) throw new Error(`no rule "${selector}"`);
  return m[1]!.replace(/\s+/g, ' ');
}

const SATOSHI = { name: 'satoshi_ghost', trusted: true, online: true, vendor: true, meta: 'replies in about 4 min' };
const MIRA = { name: 'mira.k', trusted: true, online: false, vendor: false, meta: 'Last seen 1 h ago' };
const SIX = badgesFromApi(['trusted', 'fast', 'veteran', 'pgp', 'security-key', 'trades-100']);

function setHover(on: boolean): void {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('hover: hover'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  setHover(false);
  vi.useRealTimers();
});

describe('Avatar (kit 2.1, ruling 2)', () => {
  it('48 / 40 / 32 measure exactly, with initials 18 / 15 / 13 and dots 14 / 12 / 10', () => {
    expect(rule('.x2f-avatar')).toContain('width: 40px; height: 40px;');
    expect(rule('.x2f-avatar')).toContain('font-size: 15px;');
    expect(rule('.x2f-avatar')).toContain('--x2f-avatar-dot: 12px;');
    expect(rule(".x2f-avatar[data-size='48']")).toBe(' width: 48px; height: 48px; font-size: 18px; --x2f-avatar-dot: 14px; ');
    expect(rule(".x2f-avatar[data-size='32']")).toBe(' width: 32px; height: 32px; font-size: 13px; --x2f-avatar-dot: 10px; ');
    expect(rule('.x2f-avatar')).toContain('font-family: var(--x2f-font-display);');
    expect(rule('.x2f-avatar')).toContain('font-weight: 700;');
  });

  it('teal ring only for Trusted; the dot ring matches what it sits on', () => {
    expect(rule(".x2f-avatar[data-trusted='true']")).toContain('border-color: color-mix(in srgb, var(--x2f-escrow) 70%, transparent);');
    expect(rule('.x2f-avatar__dot')).toContain('border: 2px solid var(--x2f-avatar-ring);');
    expect(rule(".x2f-avatar[data-on='raised']")).toContain('--x2f-avatar-ring: var(--x2f-surface-raised);');
    const { host } = render(
      <>
        <Avatar name="satoshi_ghost" trusted online />
        <Avatar name="lowtide" />
      </>,
    );
    const [a, b] = [...host.querySelectorAll('.x2f-avatar')];
    expect(a!.getAttribute('data-trusted')).toBe('true');
    expect(a!.getAttribute('aria-hidden')).toBe('true');
    expect(a!.textContent).toBe('SG');
    expect(a!.querySelector('[data-part="avatar-dot"]')).not.toBeNull();
    expect(b!.hasAttribute('data-trusted')).toBe(false);
  });

  it('offline has no dot and keeps the ring (ruling 10); the blocked marker is 18 px danger bottom-right', () => {
    const { host } = render(
      <>
        <Avatar name="mira.k" trusted />
        <Avatar name="spam_bot" online blocked />
      </>,
    );
    const [off, blocked] = [...host.querySelectorAll('.x2f-avatar')];
    expect(off!.querySelector('[data-part="avatar-dot"]')).toBeNull();
    expect(off!.getAttribute('data-trusted')).toBe('true');
    expect(blocked!.querySelector('[data-part="avatar-dot"]')).toBeNull();
    expect(blocked!.querySelector('[data-part="avatar-blocked"]')).not.toBeNull();
    expect(rule('.x2f-avatar__blocked')).toContain('right: -3px; bottom: -3px;');
    expect(rule('.x2f-avatar__blocked')).toContain('width: 18px; height: 18px;');
    expect(rule('.x2f-avatar__blocked')).toContain('background: var(--x2f-danger);');
  });

  it('initials', () => {
    expect(initialsOf('satoshi_ghost')).toBe('SG');
    expect(initialsOf('mira.k')).toBe('MK');
    expect(initialsOf('lowtide')).toBe('LO');
    expect(initialsOf('')).toBe('?');
  });
});

describe('RoleTag (kit 2.2, ruling 15)', () => {
  it('Vendor, Team member, X2F Moderator and X2F team: 20 h, radius 6, 11/14 600 caps .04em, padding 0 6', () => {
    const base = rule('.x2f-tag');
    for (const d of ['height: 20px;', 'padding: 0 6px;', 'border-radius: var(--x2f-radius-sm);', 'font-size: 11px;', 'line-height: 14px;', 'font-weight: 600;', 'letter-spacing: 0.04em;', 'text-transform: uppercase;']) {
      expect(base).toContain(d);
    }
    expect(rule(".x2f-tag[data-role='team']")).toContain('color: var(--x2f-team);');
    expect(rule(".x2f-tag[data-role='mod']")).toContain('color: var(--x2f-mod);');
    const { host } = render(
      <>
        <RoleTag role="vendor" />
        <RoleTag role="team" />
        <RoleTag role="mod" />
        <RoleTag role="x2f" />
        <RoleTag role="neutral">You · buyer</RoleTag>
      </>,
    );
    expect([...host.querySelectorAll('.x2f-tag')].map((t) => t.textContent)).toEqual(['Vendor', 'Team member', 'X2F Moderator', 'X2F team', 'You · buyer']);
    expect(host.querySelectorAll('.x2f-tag svg')).toHaveLength(3);
  });
});

describe('ModTile (kit 2.3)', () => {
  it('joined is the 16% mod wash; pending is a line border, muted, no fill; 32 is radius 10', () => {
    expect(rule('.x2f-modtile')).toContain('background: color-mix(in srgb, var(--x2f-mod) 16%, transparent);');
    expect(rule(".x2f-modtile[data-pending='true']")).toBe(' border: 1px solid var(--x2f-line); background: transparent; color: var(--x2f-ink-muted); ');
    expect(rule(".x2f-modtile[data-size='32']")).toContain('border-radius: var(--x2f-radius-tile);');
    const { host } = render(<ModTile size={48} pending />);
    expect(host.querySelector('svg')!.getAttribute('width')).toBe('22');
  });
});

describe('IdentityRow, StatTiles, TraderCard (kit 2.4-2.6)', () => {
  it('online reads "Online" in text; numbers are mono', () => {
    const { host } = render(<IdentityRow person={SATOSHI} />);
    expect(host.textContent).toBe('SGsatoshi_ghostVendorOnline · replies in about 4 min');
    expect(host.querySelector('.x2f-ident__online')!.textContent).toBe('Online');
    expect([...host.querySelectorAll('.x2f-digits')].map((d) => d.textContent)).toEqual(['4']);
  });

  it('offline shows "Last seen" and no dot', () => {
    const { host } = render(<IdentityRow person={MIRA} />);
    expect(host.querySelector('.x2f-ident__meta')!.textContent).toBe('Last seen 1 h ago');
    expect(host.querySelector('[data-part="avatar-dot"]')).toBeNull();
  });

  it('a moderator gets the mod tile and a violet name', () => {
    const { host } = render(<IdentityRow person={{ ...MIRA, name: 'sarah.v', meta: '' }} mod />);
    expect(host.querySelector('.x2f-modtile')).not.toBeNull();
    expect(host.querySelector('.x2f-avatar')).toBeNull();
    expect(host.querySelector('.x2f-ident__name')!.getAttribute('data-mod')).toBe('true');
    expect(host.querySelector('.x2f-tag')!.textContent).toBe('X2F Moderator');
  });

  // Owner 16 Nov fonts D + sizing: value 17 (was 16), label 13 (was 12).
  it('stat tiles: three in a row, gap 6, radius 10, mono 17 value over a 13 muted label', () => {
    expect(rule('.x2f-stats')).toContain('grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px;');
    expect(rule('.x2f-stat')).toContain('border-radius: var(--x2f-radius-tile);');
    expect(rule('.x2f-stat__v')).toContain('font-family: var(--x2f-font-mono); font-size: 17px; line-height: 20px; font-weight: 500;');
    expect(rule('.x2f-stat__l')).toContain('font-size: 13px;');
    const { host } = render(<StatTiles items={traderStats({ trades: 1284, positivePct: 99.4, xmrTraded: '275.4' })} />);
    expect([...host.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['1,284', '99.4%', '275.4']);
    expect([...host.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['trades', 'positive', 'XMR traded']);
  });

  it('trader card: surface, radius 16, padding 20; identity, stats and chips 12 apart; named Seller', () => {
    expect(rule('.x2f-trader-card')).toBe(' display: flex; flex-direction: column; gap: var(--x2f-space-3); padding: var(--x2f-space-5); border-radius: var(--x2f-radius-lg); background: var(--x2f-surface); ');
    const { host } = render(<TraderCard label="Seller" person={SATOSHI} stats={traderStats({ trades: 1284, positivePct: 99.4, xmrTraded: '275.4' })} badges={SIX} />);
    const card = host.querySelector('section[aria-label="Seller"]')!;
    expect([...card.children].map((c) => c.className)).toEqual(['x2f-ident', 'x2f-stats', 'x2f-chip-row']);
    expect(card.querySelectorAll('.x2f-chip-k__pill')).toHaveLength(2);
  });

  it('compact block: 40 avatar, a hidden "Online · " and mono numbers, then chips', () => {
    const { host } = render(<CompactTrader person={{ ...SATOSHI, meta: '1,284 trades · 99.4% positive' }} badges={SIX.slice(0, 1)} side={<button type="button">Trade</button>} />);
    expect(host.querySelector('.x2f-avatar')!.getAttribute('data-size')).toBe('40');
    expect(host.querySelector('.x2f-sr-only')!.textContent).toBe('Online · ');
    expect([...host.querySelectorAll('.x2f-ident__meta .x2f-digits')].map((d) => d.textContent)).toEqual(['1,284', '99.4%']);
    expect(host.querySelector('.x2f-compact-trader__top > button')!.textContent).toBe('Trade');
    expect(host.querySelector('[aria-label^="1 more"]')).toBeNull();
  });

  it('recipient row: the amount line starts under the name (60 px), raised rules above and below', () => {
    expect(rule('.x2f-recipient__amount')).toContain('padding-left: 60px;');
    expect(rule('.x2f-recipient')).toContain('border-top: 1px solid var(--x2f-surface-raised); border-bottom: 1px solid var(--x2f-surface-raised);');
    const { host } = render(<RecipientRow person={MIRA} xmr="1.250000" fiat="$412.50" />);
    expect(host.querySelector('.x2f-recipient__amount')!.textContent).toBe('1.250000 XMR about $412.50'); // review 6
    expect(host.querySelector('.x2f-stats')).toBeNull();
  });

  it('MonoDigits splits numbers, not letters in words', () => {
    const { host } = render(<MonoDigits text="X2F: 3 of 10 · 99.4% · 12:05" />);
    expect([...host.querySelectorAll('.x2f-digits')].map((d) => d.textContent)).toEqual(['3', '10', '99.4%', '12:05']);
  });
});

describe('Badges (kit 3, rulings 1, 4, 5)', () => {
  it('Trusted is 200+ trades and 98%+ positive; API ids map to the kit set', () => {
    expect(BADGE_SET.trusted.meaning).toBe('200+ trades and 98%+ positive.');
    expect(badgeFromApi('security-key')?.key).toBe('hw');
    expect(badgeFromApi('clean-record')?.key).toBe('clean');
    expect(badgeFromApi('trades-500')?.name).toBe('500 trades');
    expect(badgeFromApi('nonsense')).toBeNull();
    expect(badgeFromApi('toString')).toBeNull();
    expect(Object.values(BADGE_SET).map((b) => b.tone)).not.toContain('monero');
  });

  it('seals at 22 / 28 / 40 have radius 999 / 9 / 12, a 16% fill and a 55% ring; milestones show the number', () => {
    expect(rule('.x2f-seal')).toContain('border: 1.5px solid color-mix(in srgb, var(--x2f-tone) 55%, transparent);');
    expect(rule('.x2f-seal')).toContain('background: color-mix(in srgb, var(--x2f-tone) 16%, var(--x2f-surface-raised));');
    expect(rule('.x2f-seal')).toContain('border-radius: var(--x2f-radius-md);');
    expect(rule(".x2f-seal[data-size='28']")).toContain('border-radius: 9px;');
    expect(rule(".x2f-seal[data-size='22']")).toContain('border-radius: var(--x2f-radius-pill);');
    expect(rule(".x2f-seal[data-size='22']")).toContain('border-width: 1px;');
    const { host } = render(
      <>
        <BadgeSeal badge={BADGE_SET.m100} size={28} />
        <BadgeSeal badge={BADGE_SET.trusted} size={22} />
      </>,
    );
    const [num, icon] = [...host.querySelectorAll('.x2f-seal')];
    expect(num!.textContent).toBe('100');
    expect(icon!.querySelector('svg')!.getAttribute('width')).toBe('13');
    expect(icon!.getAttribute('aria-hidden')).toBe('true');
  });

  it('design ruling 8 Nov: 50 and 1,000 are ink milestones; 1,000 reads "1k" at 22/28 and "1,000" at 40; New is its own grey family', () => {
    expect(BADGE_SET.m50).toMatchObject({ name: '50 trades', tone: 'ink' });
    expect(BADGE_SET.m1000).toMatchObject({ name: '1,000 trades', tone: 'ink' });
    const { host } = render(
      <>
        <BadgeSeal badge={BADGE_SET.m50} size={22} />
        <BadgeSeal badge={BADGE_SET.m1000} size={22} />
        <BadgeSeal badge={BADGE_SET.m1000} size={28} />
        <BadgeSeal badge={BADGE_SET.m1000} size={40} />
      </>,
    );
    expect([...host.querySelectorAll('.x2f-seal')].map((s) => s.textContent)).toEqual(['50', '1k', '1k', '1,000']);
    expect(BADGE_SET.new.tone).toBe('ink-muted');
    expect(Object.values(BADGE_SET).filter((b) => b.tone === 'ink-muted').map((b) => b.key)).toEqual(['new']);
  });

  it('chip: 30 h inside a 44 h button, border 32% then 60% on hover or focus', () => {
    expect(rule('.x2f-chip-k')).toContain('height: 44px; margin: -7px 0;');
    expect(rule('.x2f-chip-k__pill')).toContain('height: 30px;');
    expect(rule('.x2f-chip-k__pill')).toContain('32%, transparent);');
    expect(rule('.x2f-chip-k:hover .x2f-chip-k__pill,\n.x2f-chip-k:focus-visible .x2f-chip-k__pill')).toContain('60%, transparent);');
    const { host } = render(<BadgeChip badge={BADGE_SET.trusted} />);
    const b = host.querySelector('button')!;
    expect(b.getAttribute('aria-label')).toBe('Trusted badge: 200+ trades and 98%+ positive.');
    expect(b.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('a badge row has the 40 seal, name, meaning and earned date in mono', () => {
    const { host } = render(
      <ul>
        <BadgeRow badge={BADGE_SET.veteran} earned={{ pre: 'Earned', date: '1 Oct 2026' }} />
      </ul>,
    );
    expect(host.textContent).toBe('VeteranTrading on X2F for over a year.Earned 1 Oct 2026');
    expect(host.querySelector('.x2f-badge-row__earned .x2f-digits')!.textContent).toBe('1 Oct 2026');
  });

  it('at most two chips, then "+N"; a tap opens the sheet (phone); Esc closes and focus returns', () => {
    const { host } = render(<BadgeChips name="satoshi_ghost" badges={SIX} />);
    expect(host.querySelectorAll('.x2f-chip-k__pill')).toHaveLength(2);
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="4 more badges"]')!;
    expect(more.textContent).toBe('+4');
    more.focus();
    fire(more, new MouseEvent('click', { bubbles: true }));
    const sheet = document.querySelector('[role="dialog"]')!;
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.textContent).toContain("satoshi_ghost's badges");
    expect(sheet.querySelectorAll('.x2f-badge-row')).toHaveLength(6);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    key(sheet, 'keydown', 'Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('any chip opens the sheet', () => {
    const { host } = render(<BadgeChips name="satoshi_ghost" badges={SIX} />);
    fire(host.querySelector('.x2f-chip-k')!, new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[role="dialog"]')!.querySelectorAll('.x2f-badge-row')).toHaveLength(6);
  });

  it('desktop: hover opens the "other badges" card, it stays while over the card, and closes when the pointer leaves both', () => {
    vi.useFakeTimers();
    setHover(true);
    const { host } = render(<BadgeChips name="satoshi_ghost" badges={SIX} />);
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="4 more badges"]')!;
    fire(more, new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    const card = host.querySelector('[role="dialog"]')!;
    expect(card.getAttribute('aria-label')).toBe("satoshi_ghost's other badges");
    expect(card.querySelector('.x2f-badge-card__label')!.textContent).toBe('4 more badges');
    expect(card.querySelector('.x2f-badge-card__label .x2f-digits')!.textContent).toBe('4');
    expect(card.querySelectorAll('li')).toHaveLength(4);
    expect(more.getAttribute('aria-controls')).toBe(card.id);
    // Moving from the button onto the card keeps it open.
    fire(more, new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: card }));
    fire(card, new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', relatedTarget: more }));
    advance(500, vi);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    fire(card, new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }));
    advance(500, vi);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('desktop: Enter on "+N" opens the card, Esc closes it and focus returns', () => {
    setHover(true);
    const { host } = render(<BadgeChips name="satoshi_ghost" badges={SIX} />);
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="4 more badges"]')!;
    more.focus();
    fire(more, new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector('.x2f-badge-card')).not.toBeNull();
    fire(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector('.x2f-badge-card')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('the card is a dialog of rows, never a tooltip', () => {
    const { host } = render(<BadgeCard id="c" name="mira.k" badges={[BADGE_SET.pgp]} />);
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    expect(host.querySelector('[role="dialog"]')!.textContent).toContain('1 more badge');
  });

  it('no badges, no row', () => {
    const { host } = render(<BadgeChips name="x" badges={[]} />);
    expect(host.innerHTML).toBe('');
  });
});

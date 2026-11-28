// @vitest-environment happy-dom
// Plan 4 Task 27 (2026-10-29b) and D-020 (owner G39): the ban notice. Every string is COPY-UNSIGNED
// (the owner's draft; design words it).
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { banTier, parseBanNotice } from '../src/api/ban.js';
import { AccountBanned, BAN_NOTICE_LEAD, BAN_REASON_TEXT, BAN_TIER_COPY, BAN_UNFINISHED_LEAD, SUSPENSION_NOTICE_LEAD, type BanNotice } from '../src/screens/account/AccountBanned.js';
import { render } from './render.js';

const CONTACTS = { moderatorUrl: null, matrixUrl: 'https://matrix.to/#/#x2f-mods:matrix.org', telegramUrl: 'https://t.me/x2f_mods' };

function mount(n: BanNotice) {
  return render(
    <MemoryRouter>
      <AccountBanned notice={n} />
    </MemoryRouter>,
  );
}

describe('AccountBanned (Task 27, D-020)', () => {
  it("owner, 28 Nov 2026: a Suspension (timed site ban) says suspended, the general reason, the implemented date, the auto-lift date, and the moderator links", () => {
    const { host } = mount({
      bans: [{ kind: 'site', reasonCode: 'trade-problems', until: '2026-11-19T12:00:00.000Z', permanent: false, implementedAt: '2026-11-12T09:30:00.000Z' }],
      contacts: CONTACTS,
    });
    expect(host.querySelector('.x2f-frozen__page')?.textContent).toBe('Account suspended');
    expect(host.querySelector('h1')?.textContent).toBe('Your account has been suspended');
    expect(host.textContent).toContain('Suspension');
    expect(host.textContent).toContain(SUSPENSION_NOTICE_LEAD);
    expect(SUSPENSION_NOTICE_LEAD).toBe("We're sorry, but your account has been suspended. If you feel this has been done in error, please reach out to a moderator and ask to speak to a moderator for further details.");
    expect(host.querySelector('[data-part="ban-reason"]')?.textContent).toBe(BAN_REASON_TEXT['trade-problems']);
    expect(host.querySelector('[data-part="ban-implemented"]')?.textContent).toBe('12 Nov 2026, 09:30 UTC');
    expect(host.querySelector('[data-part="ban-end"]')?.textContent).toBe('Your suspension will be lifted automatically on 19 Nov 2026, 12:00 UTC.');
    expect(host.querySelector('[data-part="ban-end"]')?.previousElementSibling?.textContent).toBe('Lifted automatically');
    expect(host.querySelector('[data-part="ban-means"]')?.textContent).toBe(BAN_TIER_COPY.suspension.means);
    expect(BAN_TIER_COPY.suspension.means).toContain('You can still finish trades and disputes that are already under way.');
    const links = [...host.querySelectorAll('a[data-part="ban-contact"]')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([['Matrix', CONTACTS.matrixUrl], ['Telegram', CONTACTS.telegramUrl]]);
  });

  it('owner, 28 Nov 2026: a Lifetime ban (site ban, no end) says it is permanent, with its implemented date; no links when none are set', () => {
    const { host } = mount({
      bans: [{ kind: 'site', reasonCode: 'abuse', until: null, permanent: true, implementedAt: '2026-11-01T08:00:00.000Z' }],
      contacts: { moderatorUrl: null, matrixUrl: null, telegramUrl: null },
    });
    expect(host.querySelector('.x2f-frozen__page')?.textContent).toBe('Account banned');
    expect(host.querySelector('h1')?.textContent).toBe('Your account has been permanently banned');
    expect(host.textContent).toContain('Lifetime ban');
    expect(host.textContent).toContain(BAN_NOTICE_LEAD);
    expect(BAN_NOTICE_LEAD).toBe("We're sorry, but your account has been banned. If you feel this has been done in error, please reach out to a moderator and ask to speak to a moderator for further details.");
    expect(host.querySelector('[data-part="ban-implemented"]')?.textContent).toBe('1 Nov 2026, 08:00 UTC');
    expect(host.querySelector('[data-part="ban-end"]')?.textContent).toBe('Permanent');
    expect(host.querySelector('[data-part="ban-means"]')?.textContent).toBe("This ban is permanent: you can't log in to X2F again. You can still finish trades and disputes that are already under way.");
    expect(host.textContent).not.toContain('suspended');
    expect(host.querySelectorAll('a[data-part="ban-contact"]')).toHaveLength(0);
  });

  it('owner, 28 Nov 2026: a Trade ban says new trades are blocked and what is already started can be finished', () => {
    const { host } = mount({
      bans: [{ kind: 'trade', reasonCode: 'terms', until: '2026-11-19T12:00:00.000Z', permanent: false, implementedAt: '2026-11-12T09:30:00.000Z' }],
      contacts: CONTACTS,
    });
    expect(host.querySelector('.x2f-frozen__page')?.textContent).toBe('Trade ban');
    expect(host.querySelector('h1')?.textContent).toBe('Your account has been banned from trading');
    expect(host.querySelector('[data-part="ban-reason"]')?.textContent).toBe(BAN_REASON_TEXT.terms);
    expect(host.querySelector('[data-part="ban-implemented"]')?.textContent).toBe('12 Nov 2026, 09:30 UTC');
    expect(host.querySelector('[data-part="ban-end"]')?.textContent).toBe('Your trade ban ends on 19 Nov 2026, 12:00 UTC.');
    expect(host.querySelector('[data-part="ban-means"]')?.textContent).toBe(
      "You can't start or accept new trades. Trades you already started carry on, and you can still log in, look at offers and use your wallets.",
    );
    expect(host.textContent).not.toContain('suspended');
    // A trade ban for good says Permanent.
    expect(mount({ bans: [{ kind: 'trade', reasonCode: 'terms', until: null, permanent: true }], contacts: CONTACTS }).host.querySelector('[data-part="ban-end"]')?.textContent).toBe('Permanent');
  });

  it('a trade ban and a site ban together: the site ban (it says more) is shown', () => {
    const { host } = mount({
      bans: [
        { kind: 'trade', reasonCode: 'terms', until: null, permanent: true, implementedAt: '2026-11-01T08:00:00.000Z' },
        { kind: 'site', reasonCode: 'abuse', until: '2026-11-19T12:00:00.000Z', permanent: false, implementedAt: '2026-11-12T09:30:00.000Z' },
      ],
      contacts: CONTACTS,
    });
    expect(host.querySelector('h1')?.textContent).toBe('Your account has been suspended');
    expect(host.querySelector('[data-part="ban-implemented"]')?.textContent).toBe('12 Nov 2026, 09:30 UTC');
  });

  it('an older API without implementedAt: no implemented line, the rest as before', () => {
    const { host } = mount({ bans: [{ kind: 'site', reasonCode: 'abuse', until: '2026-11-19T12:00:00.000Z', permanent: false }], contacts: CONTACTS });
    expect(host.querySelector('[data-part="ban-implemented"]')).toBeNull();
    expect(host.querySelector('h1')?.textContent).toBe('Your account has been suspended');
  });

  it('the tiers: a trade ban (timed or not), a timed site ban is a suspension, a site ban with no end a lifetime ban', () => {
    expect(banTier({ kind: 'trade', until: '2026-11-19T12:00:00.000Z' })).toBe('trade');
    expect(banTier({ kind: 'trade', until: null })).toBe('trade');
    expect(banTier({ kind: 'site', until: '2026-11-19T12:00:00.000Z' })).toBe('suspension');
    expect(banTier({ kind: 'site', until: null })).toBe('lifetime');
  });

  it('api/ban.ts reads the notice: implementedAt kept when it is a moment, dropped otherwise; malformed bans left out', () => {
    const n = parseBanNotice({
      bans: [
        { kind: 'site', reasonCode: 'abuse', until: '2026-11-19T12:00:00.000Z', permanent: false, implementedAt: '2026-11-12T09:30:00.000Z' },
        { kind: 'trade', reasonCode: 'terms', until: null, permanent: true, implementedAt: 'yesterday' },
        { kind: 'site', reasonCode: 'nope', until: null, permanent: true },
        { kind: 'other', reasonCode: 'abuse', until: null, permanent: true },
        { kind: 'site', reasonCode: 'abuse', until: 'soon', permanent: false },
      ],
      unfinished: [{ code: 'K7M2-9QXA-4FTR-8WPN', dispute: true }],
      contacts: { moderatorUrl: 'https://example.org/mods', matrixUrl: null },
    });
    expect(n).toEqual({
      bans: [
        { kind: 'site', reasonCode: 'abuse', until: '2026-11-19T12:00:00.000Z', permanent: false, implementedAt: '2026-11-12T09:30:00.000Z' },
        { kind: 'trade', reasonCode: 'terms', until: null, permanent: true },
      ],
      unfinished: [{ code: 'K7M2-9QXA-4FTR-8WPN', dispute: true }],
      contacts: { moderatorUrl: 'https://example.org/mods', matrixUrl: null, telegramUrl: null },
    });
    expect(parseBanNotice(null)).toEqual({ bans: [], contacts: { moderatorUrl: null, matrixUrl: null, telegramUrl: null } });
  });

  it('review S1: a site ban with unfinished trades lists each with a link to its room, or its dispute', () => {
    const { host } = mount({
      bans: [{ kind: 'site', reasonCode: 'abuse', until: null, permanent: true }],
      unfinished: [{ code: 'K7M2-9QXA-4FTR-8WPN', dispute: false }, { code: 'AB2C-3DEF-4GHJ-5KMN', dispute: true }],
      contacts: CONTACTS,
    });
    const section = host.querySelector('[data-part="ban-unfinished"]')!;
    expect(section.textContent).toContain(BAN_UNFINISHED_LEAD);
    const links = [...section.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Trade K7M2-9QXA-4FTR-8WPN', '/trade/K7M2-9QXA-4FTR-8WPN'],
      ['Dispute on trade AB2C-3DEF-4GHJ-5KMN', '/trade/AB2C-3DEF-4GHJ-5KMN/dispute'],
    ]);
    // Nothing unfinished (or an older API without the field): no list.
    expect(mount({ bans: [{ kind: 'site', reasonCode: 'abuse', until: null, permanent: true }], unfinished: [], contacts: CONTACTS }).host.querySelector('[data-part="ban-unfinished"]')).toBeNull();
    expect(mount({ bans: [{ kind: 'site', reasonCode: 'abuse', until: null, permanent: true }], contacts: CONTACTS }).host.querySelector('[data-part="ban-unfinished"]')).toBeNull();
  });

  it('the four general reasons have their words, and only those', () => {
    expect(Object.keys(BAN_REASON_TEXT).sort()).toEqual(['abuse', 'account-security', 'terms', 'trade-problems']);
  });
});

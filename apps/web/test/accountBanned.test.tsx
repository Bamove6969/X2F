// @vitest-environment happy-dom
// Plan 4 Task 27 (2026-10-29b) and D-020 (owner G39): the ban notice. Every string is COPY-UNSIGNED
// (the owner's draft; design words it).
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AccountBanned, BAN_NOTICE_LEAD, BAN_REASON_TEXT, BAN_UNFINISHED_LEAD, type BanNotice } from '../src/screens/account/AccountBanned.js';
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
  it("a timed site ban: the owner's draft, the general reason, the exact end, and the moderator links", () => {
    const { host } = mount({ bans: [{ kind: 'site', reasonCode: 'trade-problems', until: '2026-11-19T12:00:00.000Z', permanent: false }], contacts: CONTACTS });
    expect(host.querySelector('h1')?.textContent).toBe('Your account has been banned');
    expect(host.textContent).toContain(BAN_NOTICE_LEAD);
    expect(BAN_NOTICE_LEAD).toBe("We're sorry, but your account has been banned. If you feel this has been done in error, please reach out to a moderator and ask to speak to a moderator for further details.");
    expect(host.querySelector('[data-part="ban-reason"]')?.textContent).toBe(BAN_REASON_TEXT['trade-problems']);
    expect(host.querySelector('[data-part="ban-end"]')?.textContent).toBe('Your account will be fully working again on 19 Nov 2026, 12:00 UTC.');
    const links = [...host.querySelectorAll('a[data-part="ban-contact"]')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([['Matrix', CONTACTS.matrixUrl], ['Telegram', CONTACTS.telegramUrl]]);
  });

  it('a lifetime ban says Permanent; no links when none are set', () => {
    const { host } = mount({ bans: [{ kind: 'site', reasonCode: 'abuse', until: null, permanent: true }], contacts: { moderatorUrl: null, matrixUrl: null, telegramUrl: null } });
    expect(host.querySelector('[data-part="ban-end"]')?.textContent).toBe('Permanent');
    expect(host.querySelectorAll('a[data-part="ban-contact"]')).toHaveLength(0);
  });

  it('a trade ban alone has its own headline: the rest of the account still works', () => {
    const { host } = mount({ bans: [{ kind: 'trade', reasonCode: 'terms', until: '2026-11-19T12:00:00.000Z', permanent: false }], contacts: CONTACTS });
    expect(host.querySelector('h1')?.textContent).toBe('Your account has been banned from trading');
    expect(host.querySelector('[data-part="ban-reason"]')?.textContent).toBe(BAN_REASON_TEXT.terms);
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

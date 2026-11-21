// @vitest-environment happy-dom
// Plan 5 Task 12: the profile, badge settings and record screens against a stubbed API in the
// shapes of apps/api/src/reputation/{profile,badgeRoutes,record}.ts (apps/api/test/profile.test.ts
// checks those shapes against the real routes).
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadgeSettings } from '../src/screens/profile/BadgeSettings.js';
import { MyProfile, TraderProfileRoute } from '../src/screens/profile/Profile.js';
import { RecordExport, recordHref } from '../src/screens/profile/Record.js';
import { parseProfile, type TraderProfile } from '../src/screens/profile/api.js';
import { monthName } from '../src/screens/profile/profileCopy.js';
import { refreshSession } from '../src/session/useSession.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const PROFILE: TraderProfile = {
  displayName: 'mira.k',
  self: false,
  memberSince: '2025-03',
  online: true,
  lastSeenAt: '2026-11-18T10:00:00.000Z',
  stats: { completedTrades: 212, positivePct: 99, ratedReviews: 198, reviewCount: 205, typicalMinutes: 6, disputes: { won: 3, lost: 1 } },
  badges: { featured: ['trusted', 'fast'], more: ['veteran-1', 'pgp', 'trades-100'] },
  pgpProtected: true,
  recordPublic: true,
  tradedOverXmr: null,
  imported: [],
  reviews: [
    { neutral: false, stars: 5, phrases: ['Fast payment', 'Clear instructions'], tradeBadges: [], note: 'Paid in five minutes.', method: 'Zelle', age: 'Nov 2026', underReview: false },
    { neutral: true, stars: null, phrases: [], tradeBadges: [], note: null, method: 'Cash by mail', age: 'Oct 2026', underReview: false },
  ],
  offers: 3,
};

let calls: Call[];
let profiles: Record<string, TraderProfile>;
let badges: { earned: { id: string; level: string }[]; featured: string[]; more: string[]; nextMilestones: unknown[] };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  profiles = { 'mira.k': PROFILE, me: { ...PROFILE, displayName: 'me', self: true, recordPublic: false, pgpProtected: false } };
  badges = {
    earned: [{ id: 'new', level: 'featured' }, { id: 'veteran-1', level: 'featured' }, { id: 'pgp', level: 'hover' }],
    featured: ['new', 'veteran-1'],
    more: ['pgp'],
    nextMilestones: [{ label: '10 trades', have: 2, need: 10 }],
  };
  refreshSession();
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, method, body });
    if (input === '/v1/account/me') return json(200, { kind: 'trader', level: 'full', termsCurrent: true, displayName: 'me' });
    const m = /^\/v1\/traders\/([^/]+)$/.exec(input);
    if (m) {
      const p = profiles[decodeURIComponent(m[1]!)];
      return p ? json(200, p) : json(404, { error: 'not-found' });
    }
    if (input === '/v1/account/badges' && method === 'GET') return json(200, badges);
    if (input === '/v1/account/badges' && method === 'PUT') {
      // As the API: featuring pgp with New showing bumps Veteran.
      badges = { ...badges, earned: [{ id: 'new', level: 'featured' }, { id: 'veteran-1', level: 'hover' }, { id: 'pgp', level: 'featured' }], featured: ['new', 'pgp'], more: ['veteran-1'] };
      return json(200, { ...badges, notice: 'Veteran moved to On hover. Only 2 badges can be featured.' });
    }
    if (input.startsWith('/v1/account/record') && method === 'GET') return json(200, { text: '-----BEGIN PGP SIGNED MESSAGE-----\nX2F portable reputation record v1\n' });
    if (input === '/v1/account/record/public') return json(200, { on: (body as { on: boolean }).on });
    return json(500, { error: 'internal' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
const part = (host: HTMLElement, p: string) => host.querySelector(`[data-part="${p}"]`);
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true }));

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/u/:name" element={<TraderProfileRoute />} />
        <Route path="/settings/badges" element={<BadgeSettings />} />
        <Route path="/settings/record" element={<RecordExport now={() => new Date('2026-11-18T12:00:00Z')} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Profile', () => {
  it("shows another trader's stats, badges and reviews as the board draws them, without the cancel tile", async () => {
    const { host } = at('/u/mira.k');
    await settle();
    expect(calls.map((c) => c.url)).toContain('/v1/traders/mira.k');
    expect(host.querySelector('h1')?.textContent).toBe('Trader profile');
    expect(part(host, 'presence')?.textContent).toBe('Online · member since Mar 2025');
    expect(part(host, 'completed')?.textContent).toBe('212completed trades');
    expect(part(host, 'positive')?.textContent).toBe('99%positive (198 reviews)');
    expect(part(host, 'typical')?.textContent).toBe('~6 mintypical payment time');
    expect(part(host, 'disputes')?.textContent).toBe('Disputes: 3 won, 1 lost');
    // The cancel figure is moderators' only (owner T-017); the board's note is not app copy.
    expect(host.textContent).not.toMatch(/cancel/i);
    expect(host.textContent).not.toContain('Reviews are examples');
    // Featured chips first, the rest behind "+N".
    const chips = [...host.querySelectorAll('[data-part="badges"] .x2f-chip-k__pill')].map((e) => e.textContent);
    expect(chips).toEqual(['Trusted', 'Fast']);
    expect(host.querySelector('[data-part="badges"] [aria-label="3 more badges"]')).not.toBeNull();
    // Reviews: amber stars named in words, month and method, phrases, the note; never a reviewer.
    const reviews = host.querySelectorAll('[data-part="review"]');
    expect(reviews).toHaveLength(2);
    expect(reviews[0]!.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('5 stars');
    expect(reviews[0]!.textContent).toContain('Nov 2026 · Zelle');
    expect(reviews[0]!.textContent).toContain('Fast payment · Clear instructions');
    expect(reviews[1]!.textContent).toContain('Neutral');
    expect(part(host, 'pgp-line')?.textContent).toBe('Account protected with PGP');
    expect(part(host, 'record-line')?.textContent).toBe('Signed trade history available · Verify');
    expect(part(host, 'offers-count')?.textContent).toBe('Offers (3)');
    // Another trader's profile has Block, not my own settings links.
    expect(host.textContent).toContain('Block mira.k');
    expect(part(host, 'choose-badges')).toBeNull();
    expect(host.querySelectorAll('[data-primary]')).toHaveLength(0);
  });

  it('my own profile (the Profile tab) uses my display name and links to badges, my offers and the record', async () => {
    const { host } = at('/profile');
    await settle();
    expect(calls.map((c) => c.url)).toContain('/v1/traders/me');
    expect(host.querySelector('[data-screen="profile"]')?.getAttribute('data-self')).toBe('true');
    expect(part(host, 'choose-badges')?.getAttribute('href')).toBe('/settings/badges');
    expect(part(host, 'my-offers')?.getAttribute('href')).toBe('/profile/offers');
    expect(part(host, 'record-settings')?.getAttribute('href')).toBe('/settings/record');
    // Hidden PGP badge, private record: neither line.
    expect(part(host, 'pgp-line')).toBeNull();
    expect(part(host, 'record-line')).toBeNull();
    expect(host.textContent).not.toContain('Block me');
  });

  it('an unknown name says so; no disputes reads "Disputes: none"', async () => {
    const { host } = at('/u/nobody');
    await settle();
    expect(host.textContent).toContain('No trader has that name.');
    profiles.quiet = { ...PROFILE, displayName: 'quiet', stats: { ...PROFILE.stats, positivePct: null, typicalMinutes: null, disputes: { won: 0, lost: 0 } } };
    const q = at('/u/quiet');
    await settle();
    expect(part(q.host, 'disputes')?.textContent).toBe('Disputes: none');
    expect(part(q.host, 'typical')).toBeNull();
  });

  it('parses strictly: a renamed field fails', () => {
    expect(parseProfile(PROFILE)).toEqual(PROFILE);
    expect(() => parseProfile({ ...PROFILE, stats: { ...PROFILE.stats, completedTrades: '212' } })).toThrow(/stats/);
    expect(() => parseProfile({ ...PROFILE, badges: ['trusted'] })).toThrow(/badges/);
    expect(monthName('2025-03')).toBe('Mar 2025');
  });
});

describe('BadgeSettings', () => {
  it('New has no controls; featuring a third shows the board notice and the new lists', async () => {
    const { host } = at('/settings/badges');
    await settle();
    expect(part(host, 'featured-count')?.textContent).toBe('Featured 2 of 2');
    const newRow = host.querySelector('[data-badge="new"]')!;
    expect(newRow.querySelectorAll('button')).toHaveLength(0);
    expect(host.textContent).toContain("The New badge always shows while you have it and can't be hidden.");
    expect(part(host, 'milestones')?.textContent).toContain('2 / 10');
    const pgp = host.querySelector('[data-badge="pgp"]')!;
    expect(pgp.querySelector('[aria-pressed="true"]')?.textContent).toBe('On hover');
    click(pgp.querySelector('[data-part="level-featured"]')!);
    await settle();
    expect(calls.at(-1)).toEqual({ url: '/v1/account/badges', method: 'PUT', body: { id: 'pgp', level: 'featured' } });
    expect(part(host, 'notice')?.getAttribute('role')).toBe('status');
    expect(part(host, 'notice')?.textContent).toBe('Veteran moved to On hover. Only 2 badges can be featured.');
    expect(host.querySelector('[data-badge="veteran-1"]')?.getAttribute('data-level')).toBe('hover');
    expect(host.querySelector('[data-badge="pgp"]')?.getAttribute('data-level')).toBe('featured');
  });
});

describe('RecordExport', () => {
  it('makes the record, offers it as a data: file, and switches it onto my profile', async () => {
    const { host } = at('/settings/record');
    await settle();
    // The fingerprint is off unless ticked (P5-A35).
    click(part(host, 'make-record')!);
    await settle();
    expect(calls.some((c) => c.url === '/v1/account/record' && c.method === 'GET')).toBe(true);
    const save = part(host, 'save-record')!;
    expect(save.getAttribute('download')).toBe('x2f-reputation-2026-11-18.txt');
    expect(save.getAttribute('href')).toBe(recordHref('-----BEGIN PGP SIGNED MESSAGE-----\nX2F portable reputation record v1\n'));
    const sw = part(host, 'show-record')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    click(sw);
    await settle();
    expect(calls.at(-1)).toEqual({ url: '/v1/account/record/public', method: 'PUT', body: { on: true } });
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});

// @vitest-environment happy-dom
// Plan 5 Task 19 (Revision 2026-10-29b, owner): "Under review" on every profile, and the Dispute
// link and screen on my own. Against a stubbed API in the shapes of apps/api/src/reputation/profile.ts
// and apps/api/src/reviews/routes.ts (apps/api/test/reviewDisputes.test.ts checks those against the
// real routes).
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyProfile, TraderProfileRoute } from '../src/screens/profile/Profile.js';
import { parseProfile, type TraderProfile } from '../src/screens/profile/api.js';
import { DisputeReview } from '../src/screens/review/DisputeReview.js';
import { refreshSession } from '../src/session/useSession.js';
import { fire, render } from './render.js';

const ID = '3f2b6a1e-5c4d-4e8f-9a0b-1c2d3e4f5a6b';
const BASE: TraderProfile = {
  tradeTag: 'mira.k',
  self: false,
  memberSince: '2025-03',
  online: false,
  lastSeenAt: null,
  stats: { completedTrades: 4, positivePct: 100, ratedReviews: 1, reviewCount: 2, typicalMinutes: null, disputes: { won: 0, lost: 0 } },
  badges: { featured: ['new'], more: [] },
  pgpProtected: false,
  recordPublic: false,
  tradedOverXmr: null,
  imported: [],
  reviews: [
    { neutral: false, stars: 1, phrases: ['Slow'], tradeBadges: [], note: 'Rude and slow', method: 'Zelle', age: 'Nov 2026', underReview: true },
    { neutral: false, stars: 5, phrases: ['Friendly'], tradeBadges: [], note: null, method: 'Zelle', age: 'Oct 2026', underReview: false },
  ],
  offers: 0,
};
const MINE: TraderProfile = {
  ...BASE,
  tradeTag: 'me',
  self: true,
  reviews: [
    { neutral: false, stars: 1, phrases: ['Slow'], tradeBadges: [], note: 'Rude and slow', method: 'Zelle', age: 'Nov 2026', underReview: false, id: ID, disputable: true },
    { ...BASE.reviews[1]!, id: '9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4', disputable: false },
  ],
};

let posts: { url: string; body: unknown }[];
let answer: { status: number; body: unknown };
const json = (status: number, body: unknown) => new Response(status === 201 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  posts = [];
  answer = { status: 201, body: null };
  refreshSession();
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    if (input === '/v1/account/me') return json(200, { kind: 'trader', level: 'full', termsCurrent: true, tradeTag: 'me' });
    if (input === '/v1/traders/mira.k') return json(200, BASE);
    if (input === '/v1/traders/me') return json(200, MINE);
    if ((init.method ?? 'GET') === 'POST') {
      posts.push({ url: input, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      return json(answer.status, answer.body);
    }
    return json(500, { error: 'internal' });
  });
});
afterEach(() => vi.unstubAllGlobals());

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
const part = (host: ParentNode, p: string) => host.querySelector(`[data-part="${p}"]`);

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/u/:name" element={<TraderProfileRoute />} />
        <Route path="/profile/reviews/:id/dispute" element={<DisputeReview />} />
      </Routes>
    </MemoryRouter>,
  );
}

function type(el: HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Under review (owner 2026-10-29b)', () => {
  it('a disputed review shows "Under review" to everyone; nobody else gets a Dispute link', async () => {
    const { host } = at('/u/mira.k');
    await settle();
    const reviews = host.querySelectorAll('[data-part="review"]');
    expect(part(reviews[0]!, 'under-review')?.textContent).toBe('Under review');
    expect(part(reviews[1]!, 'under-review')).toBeNull();
    expect(part(host, 'dispute-review')).toBeNull();
  });

  it('parses underReview strictly, and an id only as a string', () => {
    expect(parseProfile(MINE)).toEqual(MINE);
    const { underReview: _u, ...noFlag } = BASE.reviews[0]!;
    expect(() => parseProfile({ ...BASE, reviews: [noFlag] })).toThrow(/review/);
    expect(() => parseProfile({ ...BASE, reviews: [{ ...BASE.reviews[0], id: 7 }] })).toThrow(/review/);
  });
});

describe('Dispute (my own profile)', () => {
  it('a Dispute link on each review I can still dispute, to the dispute screen', async () => {
    const { host } = at('/profile');
    await settle();
    const links = host.querySelectorAll('[data-part="dispute-review"]');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe(`/profile/reviews/${ID}/dispute`);
    expect(links[0]!.textContent).toBe('Dispute');
    expect(host.querySelectorAll('[data-primary]')).toHaveLength(0);
  });

  it('needs a reason; sends it trimmed and says the review is under review', async () => {
    const { host } = at(`/profile/reviews/${ID}/dispute`);
    await settle();
    expect(part(host, 'disputed-review')?.textContent).toContain('Rude and slow');
    const send = host.querySelector<HTMLButtonElement>('[data-primary]')!;
    expect(host.querySelectorAll('[data-primary]')).toHaveLength(1);
    expect(send.disabled).toBe(true);
    type(host.querySelector('textarea')!, '   ');
    expect(send.disabled).toBe(true);
    type(host.querySelector('textarea')!, '  Revenge for the dispute I opened.  ');
    expect(send.disabled).toBe(false);
    fire(send, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(posts).toEqual([{ url: `/v1/reviews/${ID}/dispute`, body: { reason: 'Revenge for the dispute I opened.' } }]);
    expect(part(host, 'dispute-sent')?.textContent).toBe('Sent. The review shows "Under review" until a moderator decides.');
    expect(host.querySelector('form')).toBeNull();
  });

  it('a review already disputed says so; one I cannot dispute is not offered', async () => {
    answer = { status: 409, body: { error: 'review-disputed' } };
    const { host } = at(`/profile/reviews/${ID}/dispute`);
    await settle();
    type(host.querySelector('textarea')!, 'Revenge.');
    fire(host.querySelector('[data-primary]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('This review has already been disputed.');
    const other = at('/profile/reviews/9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4/dispute');
    await settle();
    expect(part(other.host, 'dispute-missing')).not.toBeNull();
    expect(other.host.querySelector('textarea')).toBeNull();
  });
});


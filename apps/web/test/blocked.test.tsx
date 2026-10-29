// @vitest-environment happy-dom
// Plan 3 Task 37: the Blocked list and the Block action against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockAction } from '../src/screens/settings/BlockAction.js';
import { Blocked } from '../src/screens/settings/Blocked.js';
import { parseBlocked } from '../src/screens/settings/blockApi.js';
import { refreshSession } from '../src/session/useSession.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[];
let blocks: { displayName: string; blockedAt: string }[];
let signedIn: boolean;
let failNext: number | null;

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  signedIn = true;
  failNext = null;
  blocks = [
    { displayName: 'mira.k', blockedAt: '2026-10-29T10:00:00.000Z' },
    { displayName: 'Bob', blockedAt: '2026-10-28T10:00:00.000Z' },
  ];
  refreshSession();
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, method, body });
    if (input === '/v1/account/me') return signedIn ? json(200, { kind: 'trader', level: 'full', displayName: 'me' }) : json(401, { error: 'unauthorized' });
    if (failNext !== null) {
      const s = failNext;
      failNext = null;
      return json(s, { error: s === 404 ? 'not-found' : 'internal' });
    }
    if (input === '/v1/account/blocks' && method === 'GET') return json(200, blocks);
    if (input === '/v1/account/blocks' && method === 'POST') return json(204, null);
    const m = /^\/v1\/account\/blocks\/(.+)$/.exec(input);
    if (m && method === 'DELETE') {
      blocks = blocks.filter((b) => b.displayName !== decodeURIComponent(m[1]!));
      return json(204, null);
    }
    return json(500, { error: 'internal' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
});

const byPart = (host: HTMLElement, part: string) => host.querySelector(`[data-part="${part}"]`);

describe('Blocked (settings)', () => {
  it('lists my blocks; Unblock keeps the row with an undo, announces it, and keeps focus on the row button', async () => {
    const { host } = render(<MemoryRouter><Blocked /></MemoryRouter>);
    await settle();
    const names = [...host.querySelectorAll('[data-part="blocked-list"] [data-username]')].map((e) => e.textContent);
    expect(names).toEqual(['mira.k', 'Bob']);
    expect(byPart(host, 'blocked-count')?.textContent).toBe('2 blocked traders');
    expect(host.textContent).toContain('Blocked 29 Oct 2026');
    const first = host.querySelector<HTMLButtonElement>('[data-part="unblock"]')!;
    expect(first.getAttribute('aria-label')).toBe('Unblock mira.k');
    first.focus();
    fire(first, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.at(-1)).toMatchObject({ url: '/v1/account/blocks/mira.k', method: 'DELETE' });
    // The row stays, marked, with its one button turned into the undo; focus has not moved.
    const again = host.querySelector<HTMLButtonElement>('[data-part="unblock"]')!;
    expect(again).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(again.getAttribute('aria-label')).toBe('Block mira.k again');
    expect(host.textContent).toContain('Unblocked. They can see your offers again.');
    expect(byPart(host, 'blocked-said')?.getAttribute('role')).toBe('status');
    expect(byPart(host, 'blocked-said')?.textContent).toBe('Unblocked mira.k.');
    expect(byPart(host, 'blocked-count')?.textContent).toBe('1 blocked trader');
    // Undo blocks again.
    fire(again, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.at(-1)).toEqual({ url: '/v1/account/blocks', method: 'POST', body: { displayName: 'mira.k' } });
    expect(byPart(host, 'blocked-said')?.textContent).toBe('Blocked mira.k again.');
  });

  it('review M1: a failed unblock keeps the row; a 404 drops it only when a re-read confirms it is gone', async () => {
    const { host } = render(<MemoryRouter><Blocked /></MemoryRouter>);
    await settle();
    failNext = 500;
    fire(host.querySelector('[data-part="unblock"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not unblock mira.k. Try again.');
    expect(host.querySelectorAll('[data-username]').length).toBe(2);
    // 404, but the server still lists mira.k: the row stays and the failure is said.
    failNext = 404;
    fire(host.querySelector('[data-part="unblock"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelectorAll('[data-username]').length).toBe(2);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not unblock mira.k. Try again.');
    // 404 and the server no longer lists mira.k (the account was closed): the row goes.
    blocks = blocks.filter((b) => b.displayName !== 'mira.k');
    failNext = 404;
    fire(host.querySelector('[data-part="unblock"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect([...host.querySelectorAll('[data-username]')].map((e) => e.textContent)).toEqual(['Bob']);
  });

  it('shows the empty state with no blocks', async () => {
    blocks = [];
    const { host } = render(<MemoryRouter><Blocked /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'blocked-empty')?.textContent).toBe("You haven't blocked anyone.");
  });

  it('a list that fails to load says so', async () => {
    // The me stub answers before failNext, so only the list fails.
    failNext = 500;
    const { host } = render(<MemoryRouter><Blocked /></MemoryRouter>);
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Could not load your blocked traders/);
  });

  it('logged out: asks to log in and never calls the list', async () => {
    signedIn = false;
    const { host } = render(<MemoryRouter><Blocked /></MemoryRouter>);
    await settle();
    expect(host.textContent).toContain('Log in to see the traders you blocked.');
    expect(calls.some((c) => c.url === '/v1/account/blocks')).toBe(false);
  });

  it('parses the list strictly', () => {
    expect(() => parseBlocked({})).toThrow();
    expect(() => parseBlocked([{ displayName: 'x' }])).toThrow();
    expect(parseBlocked([{ displayName: 'x', blockedAt: 't', extra: 1 }])).toEqual([{ displayName: 'x', blockedAt: 't' }]);
  });
});

describe('BlockAction', () => {
  it('asks first (silent, open trades finish), then blocks by public name; focus follows each step', async () => {
    const onBlocked = vi.fn();
    const { host } = render(<MemoryRouter><BlockAction displayName="mira.k" onBlocked={onBlocked} /></MemoryRouter>);
    fire(byPart(host, 'block-open')!, new MouseEvent('click', { bubbles: true }));
    const ask = byPart(host, 'block-ask')!;
    expect(ask.textContent).toContain('Block mira.k?');
    expect(ask.textContent).toContain("They won't be told you blocked them.");
    expect(ask.textContent).toContain("Open trades with them aren't affected. They finish normally.");
    expect(document.activeElement).toBe(host.querySelector('#block-ask-h'));
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    fire(byPart(host, 'block-confirm')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.at(-1)).toEqual({ url: '/v1/account/blocks', method: 'POST', body: { displayName: 'mira.k' } });
    expect(onBlocked).toHaveBeenCalledOnce();
    const done = byPart(host, 'block-done')!;
    expect(done.querySelector('a')?.getAttribute('href')).toBe('/settings/blocked');
    expect(document.activeElement).toBe(done.querySelector('[role="status"]'));
  });

  it('Cancel blocks nobody; a refusal is shown inline', async () => {
    const { host } = render(<MemoryRouter><BlockAction displayName="mira.k" /></MemoryRouter>);
    fire(byPart(host, 'block-open')!, new MouseEvent('click', { bubbles: true }));
    fire([...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!, new MouseEvent('click', { bubbles: true }));
    expect(byPart(host, 'block-open')).not.toBeNull();
    // Focus is back on "Block mira.k".
    expect(document.activeElement).toBe(byPart(host, 'block-open'));
    failNext = 404;
    fire(byPart(host, 'block-open')!, new MouseEvent('click', { bubbles: true }));
    fire(byPart(host, 'block-confirm')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('That trader cannot be blocked.');
    failNext = 500;
    fire(byPart(host, 'block-open')!, new MouseEvent('click', { bubbles: true }));
    fire(byPart(host, 'block-confirm')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not block mira.k. Try again.');
  });
});

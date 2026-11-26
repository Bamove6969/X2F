// @vitest-environment happy-dom
// The Away switch on Settings, Account (owner, 26 Nov 2026): on pauses every live offer and says
// how many; off turns back on only the offers Away paused and names each one that stayed off, and why.
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AwayCard } from '../src/screens/settings/Away.js';
import { fire, render } from './render.js';
import { act } from 'react';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SINCE = '2026-11-26T12:00:00.000Z';

const OFFERS = [
  {
    id: A, side: 'sell', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', rate: '33165',
    pricing: { mode: 'market', marginBps: 50 }, minFiatCents: '5000', maxFiatCents: '200000', minTrades: null,
    status: 'paused', createdAt: '2026-10-29T10:00:00.000Z',
  },
  {
    id: B, side: 'buy', methodId: 'REVOLUT', methodName: 'Revolut', currency: 'EUR', rate: '27000',
    pricing: { mode: 'market', marginBps: -100 }, minFiatCents: '1250', maxFiatCents: '50000', minTrades: null,
    status: 'paused', createdAt: '2026-10-29T09:00:00.000Z',
  },
];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let calls: Array<{ url: string; method: string; body: unknown }>;
let away: { away: boolean; since: string | null };
let putReply: (body: { away: boolean }) => Response;

beforeEach(() => {
  calls = [];
  away = { away: false, since: null };
  putReply = (b) => json(200, b.away ? { away: true, since: SINCE, paused: [A, B] } : { away: false, since: null, resumed: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === '/v1/account/away' && method === 'GET') return json(200, away);
      if (url === '/v1/account/away' && method === 'PUT') return putReply(body as { away: boolean });
      if (url === '/v1/account/offers') return json(200, OFFERS);
      return json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const part = (host: HTMLElement, p: string) => host.querySelector(`[data-part="${p}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

function card() {
  return render(
    <MemoryRouter>
      <AwayCard />
    </MemoryRouter>,
  );
}

describe('the Away card', () => {
  it('turns Away on: the switch goes on and the card says how many offers it paused', async () => {
    const { host } = card();
    await settle();
    const toggle = part(host, 'away-toggle')!;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(host.textContent).toContain('Pauses all your live offers');
    click(toggle);
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/v1/account/away', method: 'PUT', body: { away: true } }]);
    expect(part(host, 'away-toggle')!.getAttribute('aria-checked')).toBe('true');
    expect(part(host, 'away-result')!.textContent).toBe('Away is on. 2 offers paused.');
    expect(part(host, 'away-since')).not.toBeNull();
  });

  it('turns Away off: says how many went back on and lists each one that stayed off with why', async () => {
    away = { away: true, since: SINCE };
    putReply = () => json(200, { away: false, since: null, resumed: [{ id: A, status: 'paused', refused: 'too-many-offers' }, { id: B, status: 'live' }] });
    const { host } = card();
    await settle();
    expect(part(host, 'away-toggle')!.getAttribute('aria-checked')).toBe('true');
    click(part(host, 'away-toggle'));
    await settle();
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([{ away: false }]);
    expect(part(host, 'away-toggle')!.getAttribute('aria-checked')).toBe('false');
    expect(part(host, 'away-result')!.textContent).toContain('Away is off. 1 offer back on. 1 offer stayed off');
    const lines = [...host.querySelectorAll('[data-part="away-stayed-off"] li')].map((li) => li.textContent);
    expect(lines).toEqual(['Selling XMR · USD, Zelle: Stayed off: over the offer limit.']);
  });

  it('a failed save leaves the switch as it was and says so', async () => {
    putReply = () => json(500, { error: 'internal' });
    const { host } = card();
    await settle();
    click(part(host, 'away-toggle'));
    await settle();
    expect(part(host, 'away-toggle')!.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Away wasn't changed");
  });
});

// @vitest-environment happy-dom
// Plan 4 Task 31: the trader's support tickets (/support/tickets, /support/tickets/new,
// /support/tickets/:id) against a stubbed API in the shapes of apps/api/src/tickets/traderRoutes.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TICKET_CATEGORIES } from '@x2f/core';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketNew, Tickets } from '../src/screens/support/Tickets.js';
import { TicketThread } from '../src/screens/support/TicketThread.js';
import { CATEGORY_LABELS, CATEGORY_ORDER, STATUS_LABELS, TICKET_COPY, isTicketId, whoWrote } from '../src/screens/support/tickets-model.js';
import { TOO_MANY_TICKETS, teamCantDoText } from '../src/ui/cantDoCodes.js';
import { fire, render } from './render.js';

const ID = '11111111-1111-4111-8111-111111111111';
const AT = '2026-11-20T10:00:00.000Z';
const SUMMARY = { id: ID, category: 'wallets', status: 'answered', tradeCode: null, createdAt: AT, updatedAt: AT, lastFrom: 'staff' };
const THREAD = {
  id: ID, category: 'wallets', status: 'answered', tradeCode: 'K7M2-9QXA-4FTR-8WPN', createdAt: AT, updatedAt: AT,
  messages: [
    { from: 'trader', body: 'My wallet is not\nlisted.', at: AT },
    { from: 'staff', body: 'Try adding it again.', at: AT },
  ],
};

type Answer = { status: number; json: unknown };
let route: (method: string, path: string, body: unknown) => Answer;
let calls: Array<{ method: string; path: string; body: unknown }>;

beforeEach(() => {
  calls = [];
  route = () => ({ status: 404, json: { error: 'not-found' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(String(input), 'https://x2f.test');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: u.pathname, body });
      const a = route(method, u.pathname, body);
      return new Response(JSON.stringify(a.json), { status: a.status, headers: { 'content-type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function at(path: string) {
  const r = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/support/tickets" element={<Tickets />} />
        <Route path="/support/tickets/new" element={<TicketNew />} />
        <Route path="/support/tickets/:id" element={<TicketThread />} />
        <Route path="/help/support" element={<p data-at="help">help</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return r.host;
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const primary = (host: HTMLElement) => host.querySelectorAll('[data-primary]');

describe('the words', () => {
  it('every category has a label, in the API order, "Everything else" last', () => {
    expect(CATEGORY_ORDER).toEqual(TICKET_CATEGORIES);
    expect(CATEGORY_LABELS[CATEGORY_ORDER.at(-1)!]).toBe('Everything else');
    for (const c of TICKET_CATEGORIES) expect(CATEGORY_LABELS[c].length).toBeGreaterThan(0);
  });
  it('a ticket id is a lower-case uuid only', () => {
    expect(isTicketId(ID)).toBe(true);
    for (const bad of ['../settings', 'ABCDEF12-1111-4111-8111-111111111111', `${ID}?x`, '', 7]) expect(isTicketId(bad)).toBe(false);
  });
});

describe('team tickets (owner Q69): who wrote a line', () => {
  const owner = { from: 'trader' as const, body: 'a', at: AT };
  const mira = { from: 'trader' as const, by: 'mira', body: 'b', at: AT };
  const staff = { from: 'staff' as const, body: 'c', at: AT };
  it('the account owner reads their own lines as You and a member\'s by its name', () => {
    expect([owner, mira, staff].map((m) => whoWrote(m, null))).toEqual([TICKET_COPY.you, 'mira', TICKET_COPY.staff]);
  });
  it('a member reads their own lines as You, another member\'s by its name, the owner\'s as Team owner', () => {
    expect([owner, mira, staff].map((m) => whoWrote(m, 'mira'))).toEqual([TICKET_COPY.owner, TICKET_COPY.you, TICKET_COPY.staff]);
    expect(whoWrote(mira, 'jon')).toBe('mira');
  });
  it('the thread shows the member who wrote a line', async () => {
    route = (m, p) => (m === 'GET' && p === `/v1/tickets/${ID}` ? { status: 200, json: { ...THREAD, messages: [{ ...THREAD.messages[0], by: 'mira' }, THREAD.messages[1]] } } : { status: 404, json: {} });
    const host = await at(`/support/tickets/${ID}`);
    const who = [...host.querySelectorAll('[data-part="ticket-message"] strong')].map((e) => e.textContent);
    expect(who).toEqual(['mira', TICKET_COPY.staff]);
  });
});

describe('Tickets list', () => {
  it('lists my tickets with their status, links to each, and offers one Open a ticket', async () => {
    route = (m, p) => (m === 'GET' && p === '/v1/tickets' ? { status: 200, json: { items: [SUMMARY, { ...SUMMARY, id: '../x' }] } } : { status: 404, json: {} });
    const host = await at('/support/tickets');
    const rows = host.querySelectorAll('[data-part="ticket-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Wallets');
    expect(rows[0]!.textContent).toContain(STATUS_LABELS.answered);
    expect(rows[0]!.querySelector('a')!.getAttribute('href')).toBe(`/support/tickets/${ID}`);
    expect(primary(host)).toHaveLength(1);
    expect(host.querySelector('[data-part="open-ticket"]')!.getAttribute('href')).toBe('/support/tickets/new');
  });

  it('an empty list says so', async () => {
    route = () => ({ status: 200, json: { items: [] } });
    const host = await at('/support/tickets');
    expect(host.querySelector('[data-part="no-tickets"]')!.textContent).toContain(TICKET_COPY.emptyTitle);
  });

  it('a team member is told tickets are the account owner\'s (CantDoThat)', async () => {
    route = () => ({ status: 403, json: { error: 'owner-only' } });
    await at('/support/tickets');
    const dialog = document.querySelector('[data-part="cant-do-that"]')!;
    expect(dialog.getAttribute('data-from')).toBe('owner-only');
    expect(dialog.textContent).toContain(teamCantDoText('owner-only'));
  });
});

describe('Open a ticket', () => {
  it('needs a category and a message, sends them (and the trade code), then opens the thread', async () => {
    route = (m, p) =>
      m === 'POST' && p === '/v1/tickets' ? { status: 201, json: { id: ID } } : m === 'GET' && p === `/v1/tickets/${ID}` ? { status: 200, json: THREAD } : { status: 404, json: {} };
    const host = await at('/support/tickets/new');
    const send = host.querySelector<HTMLButtonElement>('button[data-primary]')!;
    expect(send.disabled).toBe(true);
    const options = [...host.querySelectorAll('[data-part="ticket-category"]')];
    expect(options.map((o) => o.textContent)).toEqual(CATEGORY_ORDER.map((c) => CATEGORY_LABELS[c]));
    expect(host.querySelector('[data-part="ticket-privacy"]')!.textContent).toBe(TICKET_COPY.privacy);
    fire(options[3]!.querySelector('input')!, new MouseEvent('click', { bubbles: true }));
    expect(send.disabled).toBe(true);
    type(host.querySelector('textarea')!, '  My wallet is missing.  ');
    type(host.querySelector<HTMLInputElement>(`input.x2f-input`)!, 'k7m2-9qxa-4ftr-8wpn');
    expect(send.disabled).toBe(false);
    fire(host.querySelector('form')!, new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ category: 'wallets', body: 'My wallet is missing.', tradeCode: 'k7m2-9qxa-4ftr-8wpn' });
    expect(host.querySelector('[data-screen="ticket-thread"]')).not.toBeNull();
  });

  it('too many tickets open: CantDoThat with the limit; a daily cap and a bad trade code are said inline', async () => {
    let answer: Answer = { status: 409, json: { error: 'too-many-tickets' } };
    route = () => answer;
    const host = await at('/support/tickets/new');
    fire(host.querySelector('[data-part="ticket-category"] input')!, new MouseEvent('click', { bubbles: true }));
    type(host.querySelector('textarea')!, 'Hello');
    const submit = async () => {
      fire(host.querySelector('form')!, new Event('submit', { bubbles: true, cancelable: true }));
      await settle();
    };
    await submit();
    expect(document.querySelector('[data-part="cant-do-that"]')!.textContent).toContain(TOO_MANY_TICKETS.body(3));
    answer = { status: 429, json: { error: 'slow-down', limit: 'daily', retryAfterSeconds: 600 } };
    await submit();
    expect(host.querySelector('[data-part="ticket-failed"]')!.textContent).toContain('in the last day');
    answer = { status: 404, json: { error: 'not-found' } };
    await submit();
    expect(host.querySelector('[data-part="ticket-failed"]')!.textContent).toBe(TICKET_COPY.tradeUnknown);
  });

  it('desktop card sticky footer overrides ui.css transparent background with higher specificity over --x2f-surface', () => {
    const supportCss = readFileSync(join(import.meta.dirname, '..', 'src', 'screens/support/support.css'), 'utf8');
    const uiCss = readFileSync(join(import.meta.dirname, '..', 'src', 'ui/ui.css'), 'utf8');

    // Strip comments and extract top-level selector -> declaration blocks.
    const rules = (css: string) =>
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        selectors: m[1]!.split(',').map((s) => s.trim()).filter(Boolean),
        body: m[2]!,
      }));

    // Count (class + attribute + pseudo-class) tokens for selectors without IDs.
    const classAttrSpecificity = (sel: string) => (sel.match(/(\.[a-zA-Z0-9_-]+|\[[^\]]+\])/g) ?? []).length;

    const uiCardFooter = rules(uiCss)
      .flatMap((r) => r.selectors.map((s) => ({ sel: s, body: r.body })))
      .find(
        ({ sel, body }) =>
          sel.includes("[data-shell='desktop']") &&
          sel.includes(".x2f-flow[data-look='card']") &&
          sel.includes('.x2f-flow__footer') &&
          /background:\s*transparent\b/.test(body),
      );
    expect(uiCardFooter).toBeDefined();
    const uiSpec = classAttrSpecificity(uiCardFooter!.sel);
    expect(uiSpec).toBe(4);

    const supportDesktopFooter = rules(supportCss)
      .flatMap((r) => r.selectors.map((s) => ({ sel: s, body: r.body })))
      .find(
        ({ sel, body }) =>
          sel.includes("[data-shell='desktop']") &&
          sel.includes(".x2f-flow") &&
          sel.includes("[data-look='card']") &&
          sel.includes("[data-screen='ticket-new']") &&
          sel.includes('.x2f-flow__footer') &&
          /background:\s*linear-gradient\([^;]*var\(--x2f-surface\)/.test(body),
      );
    expect(supportDesktopFooter).toBeDefined();
    expect(classAttrSpecificity(supportDesktopFooter!.sel)).toBeGreaterThan(uiSpec);
  });
});

describe('the thread', () => {
  it('shows each message as text with who wrote it (never a staff name), replies and closes', async () => {
    let t: typeof THREAD = THREAD;
    route = (m, p, body) => {
      if (m === 'GET' && p === `/v1/tickets/${ID}`) return { status: 200, json: t };
      if (m === 'POST' && p === `/v1/tickets/${ID}/messages`) {
        t = { ...t, status: 'open', messages: [...t.messages, { from: 'trader', body: (body as { body: string }).body, at: AT }] };
        return { status: 200, json: t };
      }
      if (m === 'POST' && p === `/v1/tickets/${ID}/close`) {
        t = { ...t, status: 'closed' };
        return { status: 200, json: t };
      }
      return { status: 404, json: {} };
    };
    const host = await at(`/support/tickets/${ID}`);
    const msgs = [...host.querySelectorAll('[data-part="ticket-message"]')];
    expect(msgs.map((m) => m.getAttribute('data-from'))).toEqual(['trader', 'staff']);
    expect(msgs[1]!.textContent).toContain(TICKET_COPY.staff);
    expect(msgs[0]!.querySelector('.x2f-ticket-msg__body')!.textContent).toBe('My wallet is not\nlisted.');
    expect(host.querySelector('[data-part="ticket-facts"]')!.textContent).toContain('K7M2-9QXA-4FTR-8WPN');
    expect(primary(host)).toHaveLength(1);
    type(host.querySelector('textarea')!, 'Thanks');
    fire(host.querySelector('form')!, new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(host.querySelectorAll('[data-part="ticket-message"]')).toHaveLength(3);
    expect(host.querySelector('textarea')!.value).toBe('');
    fire(host.querySelector('[data-part="close-ticket"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelector('[data-part="ticket-closed"]')!.textContent).toBe(TICKET_COPY.closedNote);
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('[data-part="open-ticket"]')!.getAttribute('href')).toBe('/support/tickets/new');
    expect(primary(host)).toHaveLength(1);
  });

  it('a ticket that is not mine (or gone) says so', async () => {
    const host = await at(`/support/tickets/${ID}`);
    expect(host.querySelector('[data-part="ticket-missing"]')!.textContent).toBe(TICKET_COPY.missing);
  });
});

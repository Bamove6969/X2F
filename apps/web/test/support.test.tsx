// @vitest-environment happy-dom
// Plan 4 Task 31 / J-14: the support screens against a stubbed API (owner D-055, D-056, D-059).
import { readdirSync, readFileSync } from 'node:fs';
import { URL as NodeURL, fileURLToPath as nodePath } from 'node:url';
import { TICKETS_DAILY } from '@x2f/core';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPROMISED_COPY, Compromised, SUPPORT_COPY, Tickets } from '../src/screens/support/Support.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}
let calls: Call[];
let answer: (url: string, method: string) => [number, unknown];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  answer = () => [500, { error: 'internal' }];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url: input, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const [s, b] = answer(input, method);
    return json(s, b);
  });
});
afterEach(() => vi.unstubAllGlobals());

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true }));

describe('"My account has been compromised" (D-059)', () => {
  it('asks for the login name, method kinds only (no secret field), a comment; sends and shows the number and the contact channels', async () => {
    answer = (url, method) => (url === '/v1/tickets/compromised' && method === 'POST' ? [202, { number: 1042 }] : [500, {}]);
    const { host } = render(
      <MemoryRouter>
        <Compromised />
      </MemoryRouter>,
    );
    // Never a password, code or key field: the form has no login.
    expect(host.querySelectorAll('input[type="password"]')).toHaveLength(0);
    const inputs = [...host.querySelectorAll('input:not([type="checkbox"])')];
    expect(inputs).toHaveLength(1);
    const send = [...host.querySelectorAll('button')].find((b) => b.textContent === COMPROMISED_COPY.send)!;
    setValue(inputs[0] as HTMLInputElement, '  my-login  ');
    // Sending needs the "I understand" box.
    expect(send.disabled).toBe(true);
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    click(boxes.find((b) => b.parentElement?.textContent?.includes('A recovery code'))!);
    click(boxes.find((b) => b.parentElement?.textContent?.includes('My password'))!);
    setValue(host.querySelector('textarea')!, ' They took my phone. ');
    click(boxes.find((b) => b.parentElement?.textContent === COMPROMISED_COPY.confirm)!);
    expect(send.disabled).toBe(false);
    click(send);
    await settle();
    expect(calls).toEqual([
      { url: '/v1/tickets/compromised', method: 'POST', body: { loginName: 'my-login', methodsLeft: ['password', 'recovery-code'], comment: 'They took my phone.' } },
    ]);
    expect(host.querySelector('[data-part="compromised-number"]')?.textContent).toBe(COMPROMISED_COPY.sent(1042));
    expect(host.querySelector('[data-part="compromised-contact"]')?.textContent).toContain('Matrix');
    expect(host.querySelector('[data-part="compromised-contact"]')?.textContent).toContain('Jabber');
  });
});

describe('Tickets (D-055, D-056)', () => {
  async function tryOpen(status: number, body: unknown) {
    answer = (url, method) => (url === '/v1/tickets' && method === 'GET' ? [200, { tickets: [] }] : [status, body]);
    const { host } = render(
      <MemoryRouter>
        <Tickets />
      </MemoryRouter>,
    );
    await settle();
    setValue(host.querySelector('textarea')!, 'Where is my trade?');
    click([...host.querySelectorAll('button')].find((b) => b.textContent === SUPPORT_COPY.send)!);
    await settle();
    return document.body;
  }

  it('lists the categories with "Everything else" last', async () => {
    answer = () => [200, { tickets: [] }];
    const { host } = render(
      <MemoryRouter>
        <Tickets />
      </MemoryRouter>,
    );
    await settle();
    const options = [...host.querySelectorAll('option')].map((o) => o.textContent);
    expect(options.at(-1)).toBe('Everything else');
    expect(host.textContent).toContain(SUPPORT_COPY.none);
  });

  it('a second open ticket is a CantDoThat naming the open one', async () => {
    const body = await tryOpen(409, { error: 'ticket-open', number: 1007 });
    const popup = body.querySelector('[data-part="cant-do-that"]');
    expect(popup?.getAttribute('data-from')).toBe('ticket-open');
    expect(popup?.textContent).toContain(SUPPORT_COPY.oneOpen(1007));
    expect(calls.at(-1)).toEqual({ url: '/v1/tickets', method: 'POST', body: { category: 'everything-else', body: 'Where is my trade?' } });
  });

  it(`the ${TICKETS_DAILY + 1}th ticket of a day says the limit is there to stop spam (owner Q67)`, async () => {
    const body = await tryOpen(429, { error: 'slow-down', limit: 'daily', retryAfterSeconds: 3600 });
    const popup = body.querySelector('[data-part="cant-do-that"]');
    expect(popup?.getAttribute('data-from')).toBe('ticket-limit');
    expect(popup?.textContent).toContain('spam');
  });
});

describe('NEEDS_DESIGN_TICKETS', () => {
  it('no ticket board exists yet: when Task 31 boards land, match the screens to them and remove this tripwire', () => {
    const root = new NodeURL('../../../docs/design-screens/', import.meta.url);
    const boards = readdirSync(nodePath(root), { recursive: true }).map(String);
    expect(boards.filter((f) => /ticket|support|compromis/i.test(f))).toEqual([]);
    const src = readFileSync(nodePath(new NodeURL('../src/screens/support/Support.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('NEEDS_DESIGN_TICKETS');
  });
});

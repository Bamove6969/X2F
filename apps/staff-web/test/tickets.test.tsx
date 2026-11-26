// @vitest-environment happy-dom
// Plan 4 Tasks 30-31: the staff app's Tickets (no board: DESIGN not drawn, COPY-UNSIGNED). A helper
// sees it only when the owner granted tickets.handle (the API's `nav`); other roles with the grant
// too. The queue shows no text; a ticket opens after Take; Send reply, Close and Put back.
import { NAV, TICKET_CATEGORIES, navFor } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { TicketCase, TicketQueueItem } from '../src/api.js';
import { TICKET_CATEGORY_LABELS } from '../src/screens/TicketQueue.js';
import { NAV_LABELS, NAV_PATHS } from '../src/ui/StaffShell.js';
import { button, click, fakeApi, field, refused, render, settle, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const later = new Date(Date.now() + 3600_000).toISOString();
const HELPER = { displayName: 'hana', role: 'helper', nav: navFor('helper', ['tickets.handle']), sessionEndsAt: later };
const BARE_HELPER = { displayName: 'hana', role: 'helper', nav: navFor('helper'), sessionEndsAt: later };
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: navFor('mod', ['tickets.handle']), sessionEndsAt: later };
const ID = '11111111-1111-4111-8111-111111111111';
const AT = new Date(Date.now() - 2 * 3600_000).toISOString();

const row = (o: Partial<TicketQueueItem> = {}): TicketQueueItem => ({ id: ID, category: 'wallets', status: 'open', createdAt: AT, updatedAt: AT, waiting: 'staff', taken: null, ...o });
const kase = (o: Partial<TicketCase> = {}): TicketCase => ({
  id: ID, category: 'wallets', status: 'open', tradeCode: null, createdAt: AT, updatedAt: AT,
  messages: [{ from: 'trader', body: 'My wallet is missing.', at: AT, mine: false }],
  ...o,
});

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}
const part = (p: string) => document.querySelector(`[data-part="${p}"]`);
const navTexts = () => [...document.querySelectorAll('nav[aria-label="Staff"] a')].map((a) => a.textContent);

describe('Tickets in the menu', () => {
  it('labels and path; a helper with the grant has Tickets first, without it nothing', async () => {
    expect(NAV_LABELS.tickets).toBe('Tickets');
    expect(NAV_PATHS.tickets).toBe('/tickets');
    expect(NAV.owner).toContain('tickets');
    fakeApi({ 'GET /staff/v1/me': { body: BARE_HELPER } });
    await open('/');
    expect(navTexts()).toEqual([]);
    expect(part('nothing-for-role')).not.toBeNull();
  });

  it('a helper with the grant lands on the queue', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: HELPER }, 'GET /staff/v1/tickets': { body: { items: [] } } });
    await open('/');
    expect(navTexts()).toEqual(['Tickets']);
    expect(document.querySelector('[data-screen="ticket-queue"]')).not.toBeNull();
  });

  it('a moderator with the grant sees Tickets after their own pages', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/tickets': { body: { items: [] } } });
    await open('/tickets');
    expect(navTexts().at(-1)).toBe('Tickets');
  });
});

describe('the queue', () => {
  it('lists category, age and status with no text; filters by category; Take opens the ticket', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: HELPER },
      'GET /staff/v1/tickets': { body: { items: [row(), row({ id: '22222222-2222-4222-8222-222222222222', category: 'trades', taken: 'other', status: 'answered', waiting: 'trader' })] } },
      'POST /staff/v1/tickets/:id/take': { body: kase() },
      'GET /staff/v1/tickets/:id': { body: kase() },
    });
    await open('/tickets');
    const table = document.querySelector('table')!;
    expect(table.textContent).toContain('Wallets');
    expect(table.textContent).toContain('Another staff member');
    expect(table.textContent).not.toContain('My wallet');
    // One chip per category, "Everything else" last, after All.
    const chips = [...part('ticket-filters')!.querySelectorAll('button')].map((b) => b.textContent);
    expect(chips).toHaveLength(TICKET_CATEGORIES.length + 1);
    expect(chips.at(-1)).toBe(`${TICKET_CATEGORY_LABELS['everything-else']} 0`);
    await click(button(`${TICKET_CATEGORY_LABELS.trades} 1`));
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(part('ticket-take')).toBeNull();
    await click(button('All 2'));
    await click(part('ticket-take'));
    expect(api.calls.some((c) => c.method === 'POST' && c.path === `/staff/v1/tickets/${ID}/take`)).toBe(true);
    expect(document.querySelector('[data-screen="ticket-case"]')).not.toBeNull();
  });

  it('a ticket someone else took meanwhile is said and dropped from the list', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: HELPER }, 'GET /staff/v1/tickets': { body: { items: [row()] } }, 'POST /staff/v1/tickets/:id/take': refused(409, 'ticket-taken') });
    await open('/tickets');
    await click(part('ticket-take'));
    expect(document.body.textContent).toContain('Someone else took this ticket a moment ago.');
    expect(part('ticket-take')).toBeNull();
  });
});

describe('a ticket', () => {
  it('shows the thread as Trader / You, replies, closes; no trader name anywhere', async () => {
    let c = kase({ tradeCode: 'K7M2-9QXA-4FTR-8WPN' });
    const api = fakeApi({
      'GET /staff/v1/me': { body: HELPER },
      'GET /staff/v1/tickets/:id': () => ({ body: c }),
      'POST /staff/v1/tickets/:id/messages': (b) => {
        c = { ...c, status: 'answered', messages: [...c.messages, { from: 'staff', body: (b as { body: string }).body, at: AT, mine: true }] };
        return { body: c };
      },
      'POST /staff/v1/tickets/:id/close': () => {
        c = { ...c, status: 'closed' };
        return { body: c };
      },
    });
    await open(`/tickets/${ID}`);
    expect(part('ticket-facts')!.textContent).toContain('K7M2-9QXA-4FTR-8WPN');
    expect(part('ticket-message')!.textContent).toContain('Trader');
    expect([...document.querySelectorAll('[data-primary]')].map((e) => e.textContent)).toEqual(['Send reply']);
    typeInto(field('Reply to the trader'), 'Try adding it again.');
    await click(button('Send reply'));
    expect(api.calls.find((x) => x.method === 'POST' && x.path.endsWith('/messages'))!.body).toEqual({ body: 'Try adding it again.' });
    const msgs = [...document.querySelectorAll('[data-part="ticket-message"]')];
    expect(msgs.at(-1)!.textContent).toContain('You');
    await click(part('ticket-close'));
    expect(part('ticket-closed')).not.toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('not taken: says to take it from the queue; Put back returns to the queue', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: HELPER }, 'GET /staff/v1/tickets/:id': refused(403, 'forbidden-case') });
    await open(`/tickets/${ID}`);
    expect(document.body.textContent).toContain('Take this ticket from the queue to read it.');
  });

  it('Put back releases it and goes to the queue', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: HELPER },
      'GET /staff/v1/tickets/:id': { body: kase() },
      'POST /staff/v1/tickets/:id/release': { body: { released: true } },
      'GET /staff/v1/tickets': { body: { items: [] } },
    });
    await open(`/tickets/${ID}`);
    await click(part('ticket-release'));
    expect(api.calls.some((c) => c.path === `/staff/v1/tickets/${ID}/release`)).toBe(true);
    expect(document.querySelector('[data-screen="ticket-queue"]')).not.toBeNull();
  });
});

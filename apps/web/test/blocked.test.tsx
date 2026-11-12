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
let blocks: { displayName: string; blockedAt: string; note?: string | null }[];
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
    { displayName: 'mira.k', blockedAt: '2026-10-29T10:00:00.000Z', note: null },
    { displayName: 'Bob', blockedAt: '2026-10-28T10:00:00.000Z', note: 'Asked for my phone number.' },
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
    if (input === '/v1/account/blocks' && method === 'POST') {
      // As the server: a new block row, with no note and its own time.
      const name = (body as { displayName: string }).displayName;
      if (!blocks.some((b) => b.displayName === name)) blocks = [{ displayName: name, blockedAt: '2026-11-12T08:30:00.000Z', note: null }, ...blocks];
      return json(204, null);
    }
    const n = /^\/v1\/account\/blocks\/(.+)\/note$/.exec(input);
    if (n && method === 'PUT') {
      const raw = (body as { note: string | null }).note;
      const note = raw === null || raw.trim() === '' ? null : raw.trim();
      blocks = blocks.map((b) => (b.displayName === decodeURIComponent(n[1]!) ? { ...b, note } : b));
      return json(200, { note });
    }
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
    // S-093 (owner p7-6): the date and the time they were blocked.
    expect(host.textContent).toContain('Blocked 29 Oct 2026, 10:00 UTC');
    const first = host.querySelector<HTMLButtonElement>('[data-part="unblock"]')!;
    expect(first.textContent).toBe('Unblock');
    expect(first.getAttribute('aria-label')).toBe('Unblock mira.k');
    first.focus();
    fire(first, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.at(-1)).toMatchObject({ url: '/v1/account/blocks/mira.k', method: 'DELETE' });
    // The row stays, marked, with its one button turned into the undo; focus has not moved.
    const again = host.querySelector<HTMLButtonElement>('[data-part="unblock"]')!;
    expect(again).toBe(first);
    expect(document.activeElement).toBe(first);
    // Review N2 (WCAG 2.5.3): the accessible name starts with the visible label.
    expect(again.textContent).toBe('Undo');
    expect(again.getAttribute('aria-label')).toBe('Undo: block mira.k again');
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
    // S-093: the note is optional (an older API sends none) and a string or null; anything else fails loudly.
    expect(parseBlocked([{ displayName: 'x', blockedAt: 't', extra: 1 }])).toEqual([{ displayName: 'x', blockedAt: 't', note: null }]);
    expect(parseBlocked([{ displayName: 'x', blockedAt: 't', note: 'n' }])).toEqual([{ displayName: 'x', blockedAt: 't', note: 'n' }]);
    expect(() => parseBlocked([{ displayName: 'x', blockedAt: 't', note: 3 }])).toThrow();
  });

  it('S-093: each row shows my private note; I add, change and clear it in place (saved by name, at most 500 characters)', async () => {
    const { host } = render(<MemoryRouter><Blocked /></MemoryRouter>);
    await settle();
    const row = (name: string) => [...host.querySelectorAll('[data-part="blocked-list"] li')].find((li) => li.querySelector('[data-username]')?.textContent === name)!;
    expect(row('Bob').querySelector('[data-part="block-note"]')?.textContent).toBe('Asked for my phone number.');
    expect(row('mira.k').querySelector('[data-part="block-note"]')).toBeNull();
    expect(row('Bob').textContent).toContain('Only you can see this note.');
    // Add a note to mira.k.
    const add = row('mira.k').querySelector<HTMLButtonElement>('[data-part="note-edit"]')!;
    expect(add.textContent).toBe('Add a note');
    fire(add, new MouseEvent('click', { bubbles: true }));
    const box = row('mira.k').querySelector<HTMLTextAreaElement>('textarea[data-part="note-text"]')!;
    expect(box.maxLength).toBe(500);
    expect(document.activeElement).toBe(box);
    const type = (el: HTMLTextAreaElement, v: string) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(el, v);
      fire(el, new Event('input', { bubbles: true }));
    };
    type(box, 'Rude in chat.');
    fire(row('mira.k').querySelector('[data-part="note-save"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.at(-1)).toEqual({ url: '/v1/account/blocks/mira.k/note', method: 'PUT', body: { note: 'Rude in chat.' } });
    expect(row('mira.k').querySelector('[data-part="block-note"]')?.textContent).toBe('Rude in chat.');
    expect(byPart(host, 'blocked-said')?.textContent).toBe('Note saved for mira.k.');
    // Change Bob's, then clear it (an empty note is sent as null).
    const edit = row('Bob').querySelector<HTMLButtonElement>('[data-part="note-edit"]')!;
    expect(edit.textContent).toBe('Edit note');
    fire(edit, new MouseEvent('click', { bubbles: true }));
    const bobBox = row('Bob').querySelector<HTMLTextAreaElement>('textarea[data-part="note-text"]')!;
    expect(bobBox.value).toBe('Asked for my phone number.');
    type(bobBox, '   ');
    fire(row('Bob').querySelector('[data-part="note-save"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.at(-1)).toEqual({ url: '/v1/account/blocks/Bob/note', method: 'PUT', body: { note: null } });
    expect(row('Bob').querySelector('[data-part="block-note"]')).toBeNull();
    expect(byPart(host, 'blocked-said')?.textContent).toBe('Note removed for Bob.');
  });

  it('review M1: Unblock then Undo shows what the server holds: the note is gone and the block time is the new one', async () => {
    const { host } = render(<MemoryRouter><Blocked /></MemoryRouter>);
    await settle();
    const bob = () => [...host.querySelectorAll('[data-part="blocked-list"] li')].find((li) => li.querySelector('[data-username]')?.textContent === 'Bob')!;
    const mira = () => [...host.querySelectorAll('[data-part="blocked-list"] li')].find((li) => li.querySelector('[data-username]')?.textContent === 'mira.k')!;
    // Unblock mira.k first: her undo row must survive Bob's Undo.
    fire(mira().querySelector('[data-part="unblock"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    fire(bob().querySelector('[data-part="unblock"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    fire(bob().querySelector('[data-part="unblock"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(bob().querySelector('[data-part="block-note"]')).toBeNull();
    expect(bob().textContent).not.toContain('Only you can see this note.');
    expect(bob().querySelector('[data-part="note-edit"]')?.textContent).toBe('Add a note');
    expect(bob().textContent).toContain('Blocked 12 Nov 2026, 08:30 UTC');
    expect(mira().getAttribute('data-unblocked')).toBe('true');
  });

  it('review Q1: a row with a note says that unblocking deletes it; a row with none does not', async () => {
    const { host } = render(<MemoryRouter><Blocked /></MemoryRouter>);
    await settle();
    const row = (name: string) => [...host.querySelectorAll('[data-part="blocked-list"] li')].find((li) => li.querySelector('[data-username]')?.textContent === name)!;
    expect(row('Bob').querySelector('[data-part="note-unblock-warning"]')?.textContent).toBe('Unblocking deletes your note.');
    expect(row('mira.k').querySelector('[data-part="note-unblock-warning"]')).toBeNull();
  });

  it('S-093: Cancel keeps the note as it was; a failed save says so and keeps the old note', async () => {
    const { host } = render(<MemoryRouter><Blocked /></MemoryRouter>);
    await settle();
    const bob = () => [...host.querySelectorAll('[data-part="blocked-list"] li')].find((li) => li.querySelector('[data-username]')?.textContent === 'Bob')!;
    fire(bob().querySelector('[data-part="note-edit"]')!, new MouseEvent('click', { bubbles: true }));
    fire(bob().querySelector('[data-part="note-cancel"]')!, new MouseEvent('click', { bubbles: true }));
    expect(bob().querySelector('textarea')).toBeNull();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    fire(bob().querySelector('[data-part="note-edit"]')!, new MouseEvent('click', { bubbles: true }));
    failNext = 500;
    fire(bob().querySelector('[data-part="note-save"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not save the note for Bob. Try again.');
    expect(bob().querySelector('textarea')).not.toBeNull();
    fire(bob().querySelector('[data-part="note-cancel"]')!, new MouseEvent('click', { bubbles: true }));
    expect(bob().querySelector('[data-part="block-note"]')?.textContent).toBe('Asked for my phone number.');
  });
});

describe('BlockAction', () => {
  it('asks first (silent, open trades finish), then blocks by public name; focus follows each step', async () => {
    const onBlocked = vi.fn();
    const { host } = render(<MemoryRouter><BlockAction displayName="mira.k" onBlocked={onBlocked} /></MemoryRouter>);
    fire(byPart(host, 'block-open')!, new MouseEvent('click', { bubbles: true }));
    // The Block board's confirm sheet (portalled into the body; design review 64).
    const ask = byPart(document.body, 'block-ask')!;
    const sheet = ask.closest('[role="dialog"]')!;
    expect(sheet.querySelector('h2')?.textContent).toBe('Block mira.k?');
    const [yes, no] = [...ask.querySelectorAll('.x2f-sheet__actions button')];
    expect(yes?.className).toContain('x2f-button--danger-outline');
    expect(no?.textContent).toBe('Cancel');
    expect(ask.textContent).toContain("They won't be told you blocked them.");
    expect(ask.textContent).toContain("Open trades with them aren't affected. They finish normally.");
    expect(document.activeElement).toBe(document.querySelector('#block-ask-h'));
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    fire(byPart(document.body, 'block-confirm')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.at(-1)).toEqual({ url: '/v1/account/blocks', method: 'POST', body: { displayName: 'mira.k' } });
    expect(onBlocked).toHaveBeenCalledOnce();
    const done = byPart(host, 'block-done')!;
    expect(done.querySelector('a')?.getAttribute('href')).toBe('/settings/blocked');
    expect(document.activeElement).toBe(done.querySelector('[role="status"]'));
  });

  it('review I1: while the block is in flight the sheet cannot be closed (Esc, close, Cancel), so it never looks cancelled and then lands', async () => {
    let release: (r: Response) => void = () => undefined;
    const held = new Promise<Response>((r) => (release = r));
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string, init: RequestInit = {}) => ((init.method ?? 'GET') === 'POST' ? held : inner(input, init)));
    const { host } = render(<MemoryRouter><BlockAction displayName="mira.k" /></MemoryRouter>);
    fire(byPart(host, 'block-open')!, new MouseEvent('click', { bubbles: true }));
    fire(byPart(document.body, 'block-confirm')!, new MouseEvent('click', { bubbles: true }));
    const sheet = () => byPart(document.body, 'block-ask')?.closest('[role="dialog"]') ?? null;
    fire(sheet()!, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fire(sheet()!.querySelector('[aria-label="Close"]')!, new MouseEvent('click', { bubbles: true }));
    expect(sheet()).not.toBeNull();
    expect(byPart(host, 'block-open')).not.toBeNull();
    release(new Response(null, { status: 204 }));
    await settle();
    expect(byPart(host, 'block-done')).not.toBeNull();
  });

  it('Cancel blocks nobody; a refusal opens CantDoThat, a failure stays inline', async () => {
    const { host } = render(<MemoryRouter><BlockAction displayName="mira.k" /></MemoryRouter>);
    fire(byPart(host, 'block-open')!, new MouseEvent('click', { bubbles: true }));
    fire([...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!, new MouseEvent('click', { bubbles: true }));
    expect(byPart(host, 'block-open')).not.toBeNull();
    // Focus is back on "Block mira.k".
    expect(document.activeElement).toBe(byPart(host, 'block-open'));
    failNext = 404;
    fire(byPart(host, 'block-open')!, new MouseEvent('click', { bubbles: true }));
    fire(byPart(document.body, 'block-confirm')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    // Task 21's popup (portalled into the body), with its feedback link for this refusal.
    const popup = document.querySelector('[data-part="cant-do-that"]')!;
    expect(popup.getAttribute('data-from')).toBe('cannot-block');
    expect(popup.querySelector('[data-part="cant-do-message"]')?.textContent).toBe('That trader cannot be blocked.');
    expect(popup.querySelector('a')?.getAttribute('href')).toBe('/feedback?from=cannot-block');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(popup.closest('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
    fire([...popup.querySelectorAll('button')].find((b) => b.textContent === 'OK')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(document.querySelector('[data-part="cant-do-that"]')).toBeNull();
    expect(document.activeElement).toBe(byPart(host, 'block-open'));
    failNext = 500;
    fire(byPart(host, 'block-open')!, new MouseEvent('click', { bubbles: true }));
    fire(byPart(document.body, 'block-confirm')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not block mira.k. Try again.');
  });
});

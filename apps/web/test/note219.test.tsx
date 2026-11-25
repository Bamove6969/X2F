// @vitest-environment happy-dom
// Owner demo note #219 (25 Nov 2026): "any page that has a continue it next or finish or whatever
// button that shouldn't do anything until a user has completed an action I want the button faded and
// not illuminated until the user has completed their call to action." The primary stays disabled
// (the site's dimmed primary) until the screen's input passes its client-side check; the reason is
// said near it once there is something to say. Server-only checks stay errors after the press.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTotpCode } from '../src/screens/auth/loginRules.js';
import { POST_MISSING, PostOffer, missingParts, shownErrors } from '../src/screens/PostOffer.js';
import { DEFAULT_FORM, POST_COPY, validate, type FormState } from '../src/screens/post/offerForm.js';
import { AddPassword } from '../src/screens/settings/Methods.js';
import { fire, render } from './render.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const leave = (el: Element) => act(() => void el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

describe('isTotpCode: six digits, spaces ignored, as the server reads a code', () => {
  it('accepts six digits only', () => {
    expect(isTotpCode('123456')).toBe(true);
    expect(isTotpCode(' 123 456 ')).toBe(true);
    expect(isTotpCode('12345')).toBe(false);
    expect(isTotpCode('1234567')).toBe(false);
    expect(isTotpCode('12345a')).toBe(false);
    expect(isTotpCode('')).toBe(false);
  });
});

describe('Post offer: which problems show, and the hint by the dimmed button', () => {
  /** One USD band with nothing typed, paid by Zelle (what /post?method=ZELLE opens on, in fiat). */
  const blank = (): FormState => ({
    ...DEFAULT_FORM,
    unit: 'fiat',
    currencies: ['USD'],
    bands: { USD: [{ key: 1, min: '', max: '', marginSide: 'above', marginPct: '0', minTrades: null }] },
    methods: [{ methodId: 'ZELLE', adjustBps: 0, same: true, instructions: '', byCurrency: {} }],
  });

  it("a band box's problem waits until that box is left; the band rule until any of its boxes is", () => {
    const all = validate(blank()).errors;
    expect(all.bands?.USD?.rows[1]?.min).toBeDefined();
    expect(shownErrors(all, blank(), new Set())).toEqual({});
    const shown = shownErrors(all, blank(), new Set(['USD-1-min']));
    expect(shown.bands?.USD?.rows[1]).toEqual({ min: all.bands!.USD!.rows[1]!.min });
  });

  it("a method's problem waits for the method box (or a removal); a currency's shows at once", () => {
    const none = { ...blank(), methods: [] };
    const all = validate(none).errors;
    expect(all.methods).toBe(POST_COPY.pickMethod);
    expect(shownErrors(all, none, new Set()).methods).toBeUndefined();
    expect(shownErrors(all, none, new Set(['method'])).methods).toBe(POST_COPY.pickMethod);
    const noCurrency = { ...blank(), currencies: [], bands: {} };
    expect(shownErrors(validate(noCurrency).errors, noCurrency, new Set()).currencies).toBe(POST_COPY.pickCurrency);
  });

  it('names what is still missing, in the form order', () => {
    expect(missingParts(validate({ ...blank(), methods: [] }).errors)).toEqual(['payment methods', 'trade sizes and prices']);
    expect(POST_MISSING(['payment methods', 'trade sizes and prices'])).toBe('To post this offer, finish payment methods, trade sizes and prices.');
  });

  it('keeps Post offer disabled until the bands pass, with the hint tied to it, then posts', async () => {
    const posted: unknown[] = [];
    const methods = { live: [], all: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 0, bestRate: null }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://x2f.test');
        const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname === '/v1/methods') return json(methods);
        if (url.pathname === '/v1/offers' && init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)));
          return json({ id: 'o1' }, 201);
        }
        return json({ error: 'price-unavailable' }, 503);
      }),
    );
    sessionStorage.clear();
    const { host } = render(
      <MemoryRouter initialEntries={['/post?method=ZELLE']}>
        <PostOffer />
      </MemoryRouter>,
    );
    const settle = async () => {
      for (let i = 0; i < 6; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
    };
    await settle();
    const post = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Post offer')!;
    const hint = () => host.querySelector('[data-part="post-missing"]');
    expect(post().disabled).toBe(true);
    expect(hint()?.textContent).toBe('To post this offer, finish trade sizes and prices.');
    expect(post().getAttribute('aria-describedby')).toBe(hint()!.id);
    // Nothing is said under a box before it is left.
    expect(host.querySelector('#USD-1-min')!.getAttribute('aria-invalid')).toBeNull();
    leave(host.querySelector('#USD-1-min')!);
    expect(host.querySelector('#USD-1-min')!.getAttribute('aria-invalid')).toBe('true');
    fire(post(), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(posted).toEqual([]);
    type(host.querySelector<HTMLInputElement>('#USD-1-min')!, '0.5');
    type(host.querySelector<HTMLInputElement>('#USD-1-max')!, '2');
    expect(post().disabled).toBe(false);
    expect(hint()).toBeNull();
    fire(post(), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(posted).toHaveLength(1);
  });
});

describe('Settings, Set a password: Save waits for the password rules', () => {
  it('is disabled until the rules are met, with the rules as quiet help once something is typed', () => {
    const { host } = render(<AddPassword prove={async () => 'token'} onDone={() => undefined} onCancel={() => undefined} />);
    const save = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    const input = host.querySelector<HTMLInputElement>('#new-password')!;
    expect(save().disabled).toBe(true);
    expect(host.querySelector('[data-part="password-rules"]')).toBeNull();
    type(input, 'short');
    expect(save().disabled).toBe(true);
    expect(host.querySelector('[data-part="password-rules"]')?.textContent).toBe('Use at least 10 characters, with upper and lower case letters, a number and a symbol.');
    expect(input.getAttribute('aria-describedby')).toBe('new-password-rules');
    type(input, 'Another-Horse-8');
    expect(save().disabled).toBe(false);
    expect(host.querySelector('[data-part="password-rules"]')).toBeNull();
  });
});

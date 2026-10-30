// @vitest-environment happy-dom
// Plan 5 Task 21 (owner, 2026-10-29; spec 5.2): the shared "can't do that" popup and the feedback form.
// The copy-lint rule, its ratchet and the design tripwire are in cantDoThat-lint.test.ts (node env).
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_ANON_HINT, FEEDBACK_BAD_TEXT, FEEDBACK_THANKS, Feedback, fromCode } from '../src/screens/Feedback.js';
import { refreshSession } from '../src/session/useSession.js';
import { logOut } from '../src/push/usePush.js';
import { CANT_DO_CODES, CantDoThat, feedbackHref } from '../src/ui/CantDoThat.js';
import { fire, render } from './render.js';

const LINE = 'If you feel this feature can be improved please leave feedback';

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

describe('CantDoThat', () => {
  it('always carries the owner\'s feedback line, with "feedback" linking to the form for this refusal', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter initialEntries={['/sell']}>
        <Routes>
          <Route path="/sell" element={<CantDoThat title="This trade can't start" body="Your account is on Starter limits." from="starter-limit" onClose={onClose} />} />
          <Route path="/feedback" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe("This trade can't start");
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('Your account is on Starter limits.');
    const line = dialog.querySelector('[data-part="feedback-line"]')!;
    expect(line.textContent).toBe(LINE);
    const link = line.querySelector('a')!;
    expect(link.textContent).toBe('feedback');
    expect(link.getAttribute('href')).toBe('/feedback?from=starter-limit');
    // No primary button: the screen under the popup keeps its one data-primary.
    expect(dialog.querySelector('[data-primary]')).toBeNull();
    fire([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'OK')!, new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fire(link, new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(document.querySelector('[data-testid="where"]')?.textContent).toBe('/feedback?from=starter-limit');
  });

  it('a code without the API shape is left off the link', () => {
    expect(feedbackHref('Bad Code')).toBe('/feedback');
    expect(feedbackHref(null)).toBe('/feedback');
    expect(feedbackHref('offer-cap')).toBe('/feedback?from=offer-cap');
    for (const c of CANT_DO_CODES) expect(feedbackHref(c)).toBe(`/feedback?from=${c}`);
  });
});

describe('Feedback form', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    refreshSession();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const ME = { displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true };

  async function open(path: string, answer: { status: number; json: unknown }, o: { signedIn?: boolean } = {}) {
    const sent: unknown[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
      if (String(url) === '/v1/account/me') return o.signedIn === false ? reply(401, { error: 'not-authenticated' }) : reply(200, ME);
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) as unknown });
      return reply(answer.status, answer.json);
    }) as typeof fetch;
    const r = render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/feedback" element={<Feedback />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    return { ...r, sent };
  }

  async function settle() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  function type(el: HTMLTextAreaElement, value: string) {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function send(host: HTMLElement) {
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it('sends a named comment with its refusal code, shows the owner\'s thank-you exactly, and moves focus to it', async () => {
    const { host, sent } = await open('/feedback?from=starter-limit', { status: 202, json: {} });
    const labels = [...host.querySelectorAll('fieldset label')].map((l) => l.textContent);
    expect(labels).toEqual(['Complaint', 'Feedback', 'Recommendation']);
    const send_ = host.querySelector<HTMLButtonElement>('[data-primary]')!;
    expect(send_.disabled).toBe(true);
    fire(host.querySelector<HTMLInputElement>('input[value="complaint"]')!, new MouseEvent('click', { bubbles: true }));
    type(host.querySelector('textarea')!, '  The cap is too low.  ');
    expect(host.querySelector('[data-part="anon-hint"]')?.textContent).toMatch(/with your username/);
    await send(host);
    expect(sent).toEqual([{ url: '/v1/feedback/form', body: { kind: 'complaint', text: 'The cap is too low.', anonymous: false, from: 'starter-limit' } }]);
    expect(host.querySelector('[data-part="feedback-thanks"]')?.textContent).toBe(FEEDBACK_THANKS);
    expect(FEEDBACK_THANKS).toBe('Thank you! Each and every comment is appreciated and reviewed to help make this community a better place for us all.');
    // Review M7: keyboard users keep their place.
    expect(document.activeElement).toBe(host.querySelector('[data-part="feedback-thanks-heading"]'));
    // The draft is gone once sent.
    expect(window.sessionStorage.getItem('x2f.feedback-draft')).toBeNull();
  });

  it('"Send anonymously" sends anonymous: true and the hint promises only what is true (review M1)', async () => {
    const { host, sent } = await open('/feedback?from=trading-hold', { status: 202, json: {} });
    const box = [...host.querySelectorAll('label')].find((l) => l.textContent === 'Send anonymously')!.querySelector('input')!;
    fire(box, new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector('[data-part="anon-hint"]')?.textContent).toBe(FEEDBACK_ANON_HINT);
    expect(FEEDBACK_ANON_HINT).toMatch(/We don't record who sent it/);
    type(host.querySelector('textarea')!, 'Hi');
    await send(host);
    // No refusal code on an anonymous send.
    expect(sent).toEqual([{ url: '/v1/feedback/form', body: { kind: 'feedback', text: 'Hi', anonymous: true } }]);
  });

  it('a signed-out visitor is told before typing, and the draft survives the log-in round trip (review M6)', async () => {
    const first = await open('/feedback', { status: 202, json: {} }, { signedIn: false });
    const line = first.host.querySelector('[data-part="feedback-login-first"]')!;
    expect(line.textContent).toMatch(/^Log in to send feedback/);
    expect(line.querySelector('a')?.getAttribute('href')).toBe('/login?returnTo=%2Ffeedback');
    expect(first.host.querySelector<HTMLButtonElement>('[data-primary]')!.disabled).toBe(true);
    fire(first.host.querySelector<HTMLInputElement>('input[value="recommendation"]')!, new MouseEvent('click', { bubbles: true }));
    type(first.host.querySelector('textarea')!, 'Keep this.');
    first.unmount();
    // Back from logging in: signed in, the same words.
    refreshSession();
    const back = await open('/feedback', { status: 202, json: {} });
    expect(back.host.querySelector('textarea')!.value).toBe('Keep this.');
    expect(back.host.querySelector<HTMLInputElement>('input[value="recommendation"]')!.checked).toBe(true);
    expect(back.host.querySelector('[data-part="feedback-login-first"]')).toBeNull();
    await send(back.host);
    expect(back.sent).toEqual([{ url: '/v1/feedback/form', body: { kind: 'recommendation', text: 'Keep this.', anonymous: false } }]);
  });

  it('round-2 N-M6: a draft another account wrote is dropped, and log-out clears the draft', async () => {
    window.sessionStorage.setItem('x2f.feedback-draft', JSON.stringify({ kind: 'complaint', text: 'from someone else', anonymous: true, owner: 'other_user' }));
    const b = await open('/feedback', { status: 202, json: {} });
    expect(b.host.querySelector('textarea')!.value).toBe('');
    expect(b.host.querySelector<HTMLInputElement>('input[value="feedback"]')!.checked).toBe(true);
    expect(window.sessionStorage.getItem('x2f.feedback-draft')).toBeNull();
    // The signed-in account's own draft is kept, under its name.
    type(b.host.querySelector('textarea')!, 'mine');
    expect(JSON.parse(window.sessionStorage.getItem('x2f.feedback-draft')!)).toMatchObject({ text: 'mine', owner: 'nightowl_44' });
    b.unmount();
    await logOut({ serviceWorker: undefined, hasPushManager: false, Notification: undefined, api: (async () => ({})) as never });
    expect(window.sessionStorage.getItem('x2f.feedback-draft')).toBeNull();
  });

  it('a session that ran out while typing is asked to log in; a 429 says when; a 400 says why (review M5)', async () => {
    const out = await open('/feedback', { status: 401, json: { error: 'not-authenticated' } });
    type(out.host.querySelector('textarea')!, 'Hi');
    await send(out.host);
    expect(out.host.querySelector('[role="alert"]')?.textContent).toBe('Log in to send feedback. What you wrote is kept.');
    out.unmount();
    const busy = await open('/feedback', { status: 429, json: { error: 'slow-down', retryAfterSeconds: 120 } });
    type(busy.host.querySelector('textarea')!, 'Hi');
    await send(busy.host);
    expect(busy.host.querySelector('[role="alert"]')?.textContent).toBe('Too many tries. Try again in 2 minutes.');
    busy.unmount();
    const bad = await open('/feedback', { status: 400, json: { error: 'bad-request' } });
    type(bad.host.querySelector('textarea')!, 'Hi');
    await send(bad.host);
    expect(bad.host.querySelector('[role="alert"]')?.textContent).toBe(FEEDBACK_BAD_TEXT);
  });

  it('keeps only a refusal code with the API shape', () => {
    expect(fromCode('?from=trading-hold')).toBe('trading-hold');
    expect(fromCode('?from=<script>')).toBeNull();
    expect(fromCode('')).toBeNull();
  });
});

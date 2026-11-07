// @vitest-environment happy-dom
// Plan 5 Task 21 (owner, 2026-10-29; spec 5.2): the shared "can't do that" popup and the feedback form.
// The copy-lint rule, its ratchet and the design tripwire are in cantDoThat-lint.test.ts (node env).
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_FORM_DAILY } from '@x2f/core';
import { FEEDBACK_ANON_HINT, FEEDBACK_BAD_TEXT, FEEDBACK_DAILY_LIMIT, FEEDBACK_THANKS, Feedback, fromCode } from '../src/screens/Feedback.js';
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
    expect(dialog.querySelector('[data-part="cant-do-message"]')?.textContent).toBe('Your account is on Starter limits.');
    const line = dialog.querySelector('[data-part="feedback-line"]')!;
    expect(line.textContent).toBe(LINE);
    const link = line.querySelector('a')!;
    expect(link.textContent).toBe('feedback');
    expect(link.getAttribute('href')).toBe('/feedback?from=starter-limit');
    // Design review X2 (board CantDoThat.dc.html): no X close, and OK is the popup's one filled primary.
    expect(dialog.querySelector('button[aria-label="Close"]')).toBeNull();
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['OK']);
    expect([...dialog.querySelectorAll('[data-primary]')].map((b) => b.textContent)).toEqual(['OK']);
    expect(dialog.querySelector('button')!.className).toContain('x2f-button--primary');
    fire([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'OK')!, new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // A tap on the scrim closes it too.
    fire(document.querySelector('[data-part="backdrop"]')!, new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fire(link, new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(document.querySelector('[data-testid="where"]')?.textContent).toBe('/feedback?from=starter-limit');
  });

  // Design v2 batch 2 (board CantDoThat / CantDoThat-Wide, wip/design-brief 0955ab95): the one
  // shared refusal dialog. Phone: a bottom sheet with a grab handle; wide: a centred dialog. An info
  // tile above the title, the title defaulting to the board's, the message describing the dialog,
  // the feedback line in an info block, OK the one orange button, no X; scrim and a swipe down close it.
  it('follows the v2 board: grab handle, info tile, default title, message as description, feedback info block', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <CantDoThat body="Sorry, you're limited to 2 offers per side (buying or selling) for each currency." from="too-many-offers" onClose={onClose} />
      </MemoryRouter>,
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe("You can't do that yet");
    expect(dialog.querySelector('[data-part="sheet-handle"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(dialog.querySelector('[data-part="cant-do-tile"]')?.getAttribute('aria-hidden')).toBe('true');
    // Review N1: the dialog describes itself with the message, so the message is not also an alert
    // (a screen reader would read it twice on open).
    const msg = dialog.querySelector('[data-part="cant-do-message"]')!;
    expect(msg.textContent).toBe("Sorry, you're limited to 2 offers per side (buying or selling) for each currency.");
    expect(dialog.getAttribute('aria-describedby')).toBe(msg.id);
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    expect(dialog.querySelector('[data-part="feedback-line"]')?.classList.contains('x2f-info-block')).toBe(true);
    expect(document.querySelector('.x2f-sheet-layer')?.getAttribute('data-wide')).toBe('dialog');
  });

  // Review M1/M2: a swipe down from the grab handle closes the sheet on a touch screen (the handle
  // takes the gesture: touch-action none, so the browser sends pointerup, not pointercancel); a
  // cancelled gesture is forgotten; a mouse drag never closes it (the wide dialog hides the handle,
  // and selecting the message with the mouse must not close it); a drag on the body does nothing.
  it('closes on a touch swipe down from the handle, never on a mouse drag or a cancelled gesture', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <CantDoThat body="No." from="too-many-offers" onClose={onClose} />
      </MemoryRouter>,
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const handle = dialog.querySelector<HTMLElement>('[data-part="sheet-handle"]')!;
    const msg = dialog.querySelector<HTMLElement>('[data-part="cant-do-message"]')!;
    const ev = (type: string, pointerType: string, clientY: number) =>
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType, clientY });
    const drag = (el: HTMLElement, pointerType: string, dy: number, end = 'pointerup') => {
      fire(el, ev('pointerdown', pointerType, 100));
      fire(el, ev(end, pointerType, 100 + dy));
    };
    drag(handle, 'touch', 20);
    expect(onClose).not.toHaveBeenCalled();
    drag(handle, 'mouse', 200);
    expect(onClose).not.toHaveBeenCalled();
    drag(msg, 'mouse', 200);
    drag(msg, 'touch', 200);
    expect(onClose).not.toHaveBeenCalled();
    // A cancelled touch, then a later pointerup with no pointerdown, is not a swipe.
    drag(handle, 'touch', 200, 'pointercancel');
    fire(handle, ev('pointerup', 'touch', 400));
    expect(onClose).not.toHaveBeenCalled();
    drag(handle, 'touch', 120);
    expect(onClose).toHaveBeenCalledTimes(1);
    drag(handle, 'pen', 120);
    expect(onClose).toHaveBeenCalledTimes(2);
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
    // Owner Q67: the 11th send of the day says the limit is there to stop spam.
    const daily = await open('/feedback', { status: 429, json: { error: 'slow-down', retryAfterSeconds: 3600, limit: 'daily' } });
    type(daily.host.querySelector('textarea')!, 'Hi');
    await send(daily.host);
    expect(daily.host.querySelector('[role="alert"]')?.textContent).toBe(FEEDBACK_DAILY_LIMIT);
    // The number comes from @x2f/core, the same constant the API counts against.
    expect(FEEDBACK_DAILY_LIMIT).toContain(`You've sent ${FEEDBACK_FORM_DAILY} today`);
    expect(FEEDBACK_FORM_DAILY).toBe(10);
    daily.unmount();
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

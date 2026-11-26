// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_ANON_HINT,
  FEEDBACK_BAD_TEXT,
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_NAMED_HINT,
  Feedback,
  clearFeedbackDraft,
} from '../src/screens/Feedback.js';
import { refreshSession, sessionEnded } from '../src/session/useSession.js';
import { fire, render } from './render.js';

interface RequestRecord {
  url: string;
  method: string;
  body: unknown;
}

let requests: RequestRecord[];
let apiResponse: { status: number; body?: unknown };

function json(status: number, body?: unknown) {
  return new Response(body !== undefined ? JSON.stringify(body) : null, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(initialPath = '/feedback') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/feedback" element={<Feedback />} />
      </Routes>
    </MemoryRouter>,
  );
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

function typeText(el: HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  set.call(el, value);
  fire(el, new Event('input', { bubbles: true }));
  fire(el, new Event('change', { bubbles: true }));
}

describe('Feedback screen', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearFeedbackDraft();
    requests = [];
    apiResponse = { status: 200, body: { ok: true } };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ url: String(input), method, body });

        if (input === '/v1/account/me') {
          return json(200, {
            kind: 'trader',
            level: 'full',
            termsCurrent: true,
            displayName: 'trader_alice',
          });
        }
        if (input === '/v1/feedback/form') {
          return json(apiResponse.status, apiResponse.body);
        }
        return json(404, { error: 'not-found' });
      }),
    );
    refreshSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearFeedbackDraft();
  });

  it('renders initial form when signed in with empty message and disabled send button', async () => {
    const { host } = mount();
    await flush();

    expect(host.querySelector('h1')?.textContent).toBe('Tell us what you think');
    expect(host.querySelector('.x2f-lead')?.textContent).toContain('Every message is read');

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('');
    expect(textarea.getAttribute('maxLength')).toBe('2000');

    const count = host.querySelector('[data-part="feedback-count"]');
    expect(count?.textContent).toContain('0 of 2000 characters');

    // Anonymous checkbox is unchecked by default
    const anonBox = host.querySelector('[data-part="feedback-anon"] input') as HTMLInputElement;
    expect(anonBox.checked).toBe(false);
    expect(host.querySelector('[data-part="anon-hint"]')?.textContent).toBe(FEEDBACK_NAMED_HINT);

    // Send button is disabled when empty
    const sendBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('updates character count and hint when toggling anonymous checkbox', async () => {
    const { host } = mount();
    await flush();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      typeText(textarea, 'Great platform, really loving the escrow!');
    });

    const count = host.querySelector('[data-part="feedback-count"]');
    expect(count?.textContent).toContain(`${textarea.value.length} of 2000 characters`);

    const sendBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);

    // Toggle anonymous checkbox
    const anonBox = host.querySelector('[data-part="feedback-anon"] input') as HTMLInputElement;
    act(() => {
      anonBox.click();
    });

    expect(host.querySelector('[data-part="anon-hint"]')?.textContent).toBe(FEEDBACK_ANON_HINT);
  });

  it('submits named feedback and shows thank you view with username', async () => {
    const { host } = mount();
    await flush();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      typeText(textarea, 'I would like to suggest a feature.');
    });

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      fire(form, new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    // Verify request
    const postReq = requests.find((r) => r.url === '/v1/feedback/form');
    expect(postReq).toBeDefined();
    expect(postReq?.body).toEqual({
      kind: 'feedback',
      text: 'I would like to suggest a feature.',
      anonymous: false,
    });

    // Verify Thank You view
    const thanksHeading = host.querySelector('[data-part="feedback-thanks-heading"]');
    expect(thanksHeading?.textContent).toBe('Thank you!');
    const sentAs = host.querySelector('[data-part="feedback-sent-as"]');
    expect(sentAs?.textContent).toBe('Sent as trader_alice.');

    // Clicking "Write another" returns to the form
    const writeAnother = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Write another'));
    expect(writeAnother).toBeDefined();
    act(() => {
      fire(writeAnother!, new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(host.querySelector('h1')?.textContent).toBe('Tell us what you think');
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('submits anonymous feedback with ?from code and shows Sent anonymously', async () => {
    const { host } = mount('/feedback?from=dispute-locked');
    await flush();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      typeText(textarea, 'Anonymous feedback with issue code');
    });

    // Check anonymous
    const anonBox = host.querySelector('[data-part="feedback-anon"] input') as HTMLInputElement;
    act(() => {
      anonBox.click();
    });

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      fire(form, new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    // In anonymous mode, the from code is dropped
    const postReq = requests.find((r) => r.url === '/v1/feedback/form');
    expect(postReq?.body).toEqual({
      kind: 'feedback',
      text: 'Anonymous feedback with issue code',
      anonymous: true,
    });

    const sentAs = host.querySelector('[data-part="feedback-sent-as"]');
    expect(sentAs?.textContent).toBe('Sent anonymously.');
  });

  it('includes ?from code when submitting named feedback', async () => {
    const { host } = mount('/feedback?from=escrow-error');
    await flush();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      typeText(textarea, 'Reporting error code');
    });

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      fire(form, new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    const postReq = requests.find((r) => r.url === '/v1/feedback/form');
    expect(postReq?.body).toEqual({
      kind: 'feedback',
      text: 'Reporting error code',
      anonymous: false,
      from: 'escrow-error',
    });
  });

  it('shows login-first prompt when visitor is signed out', async () => {
    sessionEnded();
    const { host } = mount('/feedback');
    await flush();

    const loginNote = host.querySelector('[data-part="feedback-login-first"]');
    expect(loginNote).not.toBeNull();
    expect(loginNote?.textContent).toContain('Log in to send feedback');

    const sendBtn = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('displays friendly error message on 400 bad text', async () => {
    apiResponse = { status: 400, body: { error: 'invalid-characters' } };
    const { host } = mount();
    await flush();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      typeText(textarea, 'Hidden \u0000 chars');
    });

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      fire(form, new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    const errorAlert = host.querySelector('.x2f-error[role="alert"]');
    expect(errorAlert?.textContent).toBe(FEEDBACK_BAD_TEXT);
  });

  it('displays daily limit error message on 429 daily limit', async () => {
    apiResponse = { status: 429, body: { error: 'rate-limited', limit: 'daily' } };
    const { host } = mount();
    await flush();

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      typeText(textarea, 'Spam message');
    });

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      fire(form, new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    const errorAlert = host.querySelector('.x2f-error[role="alert"]');
    expect(errorAlert?.textContent).toBe(FEEDBACK_DAILY_LIMIT);
  });
});

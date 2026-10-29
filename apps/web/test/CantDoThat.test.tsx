// Plan 5 Task 21 (owner, 2026-10-29; spec 5.2): the shared "can't do that" popup and the feedback form.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TODO_PRAGMA, lintSource } from '../../../tools/copy-lint.js';
import { FEEDBACK_THANKS, Feedback, fromCode } from '../src/screens/Feedback.js';
import { CANT_DO_CODES, CantDoThat, feedbackHref } from '../src/ui/CantDoThat.js';
import { fire, render } from './render.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
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
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function open(path: string, answer: { status: number; json: unknown }) {
    const sent: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(_url), body: JSON.parse(String(init?.body)) as unknown });
      return new Response(JSON.stringify(answer.json), { status: answer.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const r = render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/feedback" element={<Feedback />} />
        </Routes>
      </MemoryRouter>,
    );
    return { ...r, sent };
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

  it('sends a named comment with its refusal code, then shows the owner\'s thank-you exactly', async () => {
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
  });

  it('"Send anonymously" sends anonymous: true and the hint says nobody knows who sent it', async () => {
    const { host, sent } = await open('/feedback', { status: 202, json: {} });
    const box = [...host.querySelectorAll('label')].find((l) => l.textContent === 'Send anonymously')!.querySelector('input')!;
    fire(box, new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector('[data-part="anon-hint"]')?.textContent).toMatch(/without your username/);
    type(host.querySelector('textarea')!, 'Hi');
    await send(host);
    expect(sent).toEqual([{ url: '/v1/feedback/form', body: { kind: 'feedback', text: 'Hi', anonymous: true } }]);
  });

  it('a signed-out sender is asked to log in; a 429 says when to try again', async () => {
    const out = await open('/feedback', { status: 401, json: { error: 'not-authenticated' } });
    type(out.host.querySelector('textarea')!, 'Hi');
    await send(out.host);
    expect(out.host.querySelector('[role="alert"]')?.textContent).toBe('Log in to send feedback.');
    out.unmount();
    const busy = await open('/feedback', { status: 429, json: { error: 'slow-down', retryAfterSeconds: 120 } });
    type(busy.host.querySelector('textarea')!, 'Hi');
    await send(busy.host);
    expect(busy.host.querySelector('[role="alert"]')?.textContent).toBe('Too many tries. Try again in 2 minutes.');
  });

  it('keeps only a refusal code with the API shape', () => {
    expect(fromCode('?from=trading-hold')).toBe('trading-hold');
    expect(fromCode('?from=<script>')).toBeNull();
    expect(fromCode('')).toBeNull();
  });
});

describe('copy-lint: refusals go through CantDoThat', () => {
  it('flags refusal wording or a refusal code in a file that does not import CantDoThat', () => {
    expect(lintSource('export const a = "You can\'t post offers.";\n', 'a.ts').map((f) => f.rule)).toEqual(['refusal']);
    expect(lintSource('export const A = () => <p>Sorry, you are limited to 2 offers.</p>;\n', 'a.tsx').map((f) => f.rule)).toEqual(['refusal']);
    expect(lintSource("export const f = (c: string) => c === 'trading-hold';\n", 'a.ts').map((f) => f.rule)).toEqual(['refusal']);
  });

  it('passes the same file once it imports CantDoThat (or cantDoCodes), or a line is marked', () => {
    expect(lintSource("import { CantDoThat } from '../ui/CantDoThat.js';\nexport const a = \"You can't post offers.\";\n", 'a.ts')).toEqual([]);
    expect(lintSource("import { isCantDoCode } from '../../ui/cantDoCodes.js';\nexport const f = (c: string) => c === 'trading-hold';\n", 'a.ts')).toEqual([]);
    expect(lintSource('// not-a-refusal: explains storage\nexport const a = "It can\'t be undone.";\n', 'a.ts')).toEqual([]);
    expect(lintSource(`export const a = "You can't post offers."; // ${TODO_PRAGMA} later\n`, 'a.ts')).toEqual([]);
  });

  it('lets the owner\'s exact thank-you keep its "!", and nothing else', () => {
    expect(lintSource(`export const t = ${JSON.stringify(FEEDBACK_THANKS)};\n`, 'a.ts')).toEqual([]);
    expect(lintSource('export const t = "Thank you!";\n', 'a.ts').map((f) => f.rule)).toEqual(['exclamation']);
  });

  it(`keeps the refusals still shown inline (marked ${TODO_PRAGMA}) from growing`, () => {
    let count = 0;
    for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (e.isFile() && /\.(tsx?|jsx?)$/.test(e.name)) count += readFileSync(join(e.parentPath, e.name), 'utf8').split(TODO_PRAGMA).length - 1;
    }
    // 2026-10-29: auth/refusals.ts (recovery-hold, security-key-limit, login-name-set) and
    // SetupStatus's 409 on cancel. Lower this number as each moves into CantDoThat.
    expect(count).toBeLessThanOrEqual(4);
  });
});

// TRIPWIRE (local tree only): there are no Claude Design boards yet for the popup or the form (brief
// ~/x2f-comms/design-brief-2026-10-29.md, items 4 and 5; the owner wants Claude Design to decide all
// aesthetics). Both are built from the existing kit (Sheet, Button, screens.css classes) with no
// styling of their own and have no parity entry. When the boards land, match CantDoThat and
// Feedback to them, add expectParity entries for both, and delete this tripwire.
describe('Task 21 waits for its Claude Design boards', () => {
  it('NEEDS_DESIGN_CANTDOTHAT: no board for CantDoThat or the feedback form yet', () => {
    const boards = join(ROOT, 'design/x2f-app');
    const names = existsSync(boards) ? readdirSync(boards, { recursive: true }).map(String) : [];
    expect(names.filter((n) => /cant-?do|feedback/i.test(n)), 'a CantDoThat or Feedback board landed: match the screens to it').toEqual([]);
  });
});

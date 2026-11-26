// @vitest-environment happy-dom
// Sign-up names (design real-app review item 6; design gaps Job 1; owner Q54, G6, G14): step 1
// asks for ONE private username (the login name) with a live "is available" tick; the public
// Trade Tag follows on its own screen. Against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_DELAY_MS } from '../src/screens/setup/availability.js';
import { TradeTag } from '../src/screens/setup/TradeTag.js';
import { INITIAL, SetupContext, type SetupApi, type SetupState } from '../src/screens/setup/kit.js';
import { checkNewTradeTag } from '../src/screens/setup/names.js';
import { tracesBack } from '../src/screens/setup/randomName.js';
import { Username } from '../src/screens/setup/Username.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  body: unknown;
}

let calls: Call[];
/** What the stubbed name check answers, by name; a function may hold its answer back. */
let answer: (name: string) => Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  answer = async (name) => json(200, { available: name !== 'taken.name' });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, body });
    if (input === '/v1/register/name-check') return answer((body as { loginName: string }).loginName);
    return json(500, { error: 'internal' });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const byPart = <E extends Element = Element>(host: ParentNode, part: string) => host.querySelector<E>(`[data-part="${part}"]`);

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

function setup(state: Partial<SetupState> = {}) {
  const api: SetupApi = {
    state: { ...INITIAL, terms: { version: 'v1' }, ...state },
    update: vi.fn(),
    returnTo: '/sell',
    go: vi.fn(),
    path: (s) => `/setup/${s}`,
  };
  return api;
}

function show(screen: 'username' | 'display', api: SetupApi) {
  return render(
    <MemoryRouter>
      <SetupContext.Provider value={api}>{screen === 'username' ? <Username /> : <TradeTag />}</SetupContext.Provider>
    </MemoryRouter>,
  ).host;
}

const checks = () => calls.filter((c) => c.url === '/v1/register/name-check');

describe('step 1: one private username with a live tick', () => {
  it('asks for one field only, the private username, and says nobody sees it', () => {
    const host = show('username', setup());
    expect(host.querySelectorAll('input').length).toBe(1);
    expect(host.querySelector('#login-name')).toBeNull();
    // Owner demo note #197: the label reads "Private login ID", in the strong setup label style.
    expect(host.querySelector('label[for="uname"]')?.textContent).toBe('Private login ID');
    expect(host.querySelector('label[for="uname"]')?.classList.contains('x2f-start__field-label')).toBe(true);
    expect(host.querySelector('#uname')?.getAttribute('autocomplete')).toBe('username');
    expect(host.textContent).toContain('You\'ll use this private username to sign in—nobody else will ever see it.');
    expect(host.textContent).not.toContain('Traders will see');
  });

  it('checks a well-formed name once the typing pauses, and shows "<name> is available"', async () => {
    const host = show('username', setup());
    type(host.querySelector<HTMLInputElement>('#uname')!, 'juniper.oak');
    await wait(CHECK_DELAY_MS - 50);
    expect(checks()).toEqual([]);
    await wait(100);
    expect(checks()).toEqual([{ url: '/v1/register/name-check', body: { loginName: 'juniper.oak' } }]);
    const line = byPart(host, 'name-status');
    expect(line?.textContent).toBe('juniper.oak is available');
    expect(line?.getAttribute('data-tone')).toBe('escrow');
  });

  it('only the name typed last is checked (no request per keystroke)', async () => {
    const host = show('username', setup());
    const input = host.querySelector<HTMLInputElement>('#uname')!;
    for (const v of ['junip', 'junipe', 'juniper', 'juniper.o', 'juniper.oak']) {
      type(input, v);
      await wait(100);
    }
    await wait(CHECK_DELAY_MS);
    expect(checks().map((c) => c.body)).toEqual([{ loginName: 'juniper.oak' }]);
  });

  it('a name of the wrong shape is never sent', async () => {
    const host = show('username', setup());
    type(host.querySelector<HTMLInputElement>('#uname')!, 'abc');
    await wait(CHECK_DELAY_MS * 2);
    type(host.querySelector<HTMLInputElement>('#uname')!, 'has space!');
    await wait(CHECK_DELAY_MS * 2);
    expect(checks()).toEqual([]);
    expect(byPart(host, 'name-status')).toBeNull();
  });

  it('a taken name says so and Continue is disabled (owner demo note #196)', async () => {
    const api = setup();
    const host = show('username', api);
    type(host.querySelector<HTMLInputElement>('#uname')!, 'taken.name');
    await wait(CHECK_DELAY_MS + 10);
    expect(byPart(host, 'name-status')?.textContent).toBe('taken.name is taken. Try another.');
    expect(byPart(host, 'name-status')?.getAttribute('data-tone')).toBe('danger');
    expect(byPart<HTMLButtonElement>(host, 'names-continue')!.disabled).toBe(true);
    fire(byPart(host, 'names-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(byPart(host, 'names-error')).toBeNull();
    expect(api.go).not.toHaveBeenCalled();
  });

  it('when the check is paced or X2F is busy, the line is neutral and Continue still works (register checks again)', async () => {
    for (const reply of [json(429, { error: 'slow-down', retryAfterSeconds: 30 }), json(503, { error: 'busy', retryAfterSeconds: 6 })]) {
      answer = async () => reply;
      const api = setup();
      const host = show('username', api);
      type(host.querySelector<HTMLInputElement>('#uname')!, 'lumen.kai');
      await wait(CHECK_DELAY_MS + 10);
      expect(byPart(host, 'name-status')?.textContent).toBe("We'll check it when you finish.");
      expect(byPart(host, 'name-status')?.getAttribute('data-tone')).toBe('neutral');
      fire(byPart(host, 'names-continue')!, new MouseEvent('click', { bubbles: true }));
      expect(api.go).toHaveBeenCalledWith('trade-tag');
    }
  });

  it('an answer for a name no longer in the box is ignored', async () => {
    let release!: (r: Response) => void;
    answer = (name) => (name === 'first.name' ? new Promise((r) => (release = r)) : Promise.resolve(json(200, { available: true })));
    const host = show('username', setup());
    const input = host.querySelector<HTMLInputElement>('#uname')!;
    type(input, 'first.name');
    await wait(CHECK_DELAY_MS + 10);
    type(input, 'second.name');
    await wait(CHECK_DELAY_MS + 10);
    expect(byPart(host, 'name-status')?.textContent).toBe('second.name is available');
    release(json(200, { available: false }));
    await wait(10);
    expect(byPart(host, 'name-status')?.textContent).toBe('second.name is available');
  });

  it('Continue keeps the private username and goes to the Trade Tag step', async () => {
    const api = setup();
    const host = show('username', api);
    type(host.querySelector<HTMLInputElement>('#uname')!, 'Juniper.Oak');
    await wait(CHECK_DELAY_MS + 10);
    fire(byPart(host, 'names-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.update).toHaveBeenCalledWith({ loginName: 'Juniper.Oak', challenge: null });
    expect(api.go).toHaveBeenCalledWith('trade-tag');
  });

  it('Continue is disabled until the name passes the rules (owner demo note #196)', () => {
    const api = setup();
    const host = show('username', api);
    const go = byPart<HTMLButtonElement>(host, 'names-continue')!;
    const input = host.querySelector<HTMLInputElement>('#uname')!;
    expect(go.disabled).toBe(true);
    for (const bad of ['abc', 'abcdefg', 'Mira#Kai', 'Mira Kai12', 'a'.repeat(21)]) {
      type(input, bad);
      expect(go.disabled, bad).toBe(true);
      fire(go, new MouseEvent('click', { bubbles: true }));
      expect(byPart(host, 'names-error')).toBeNull();
    }
    type(input, 'abcdefgh');
    expect(go.disabled).toBe(false);
    expect(api.go).not.toHaveBeenCalled();
  });
});

describe('the Trade Tag step', () => {
  it('previews what traders see and saves the public name', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    expect(host.querySelectorAll('input').length).toBe(1);
    type(host.querySelector<HTMLInputElement>('#trade-tag')!, 'Lumen.Kai');
    expect(host.querySelector('[data-part="trader-preview"] .x2f-ident__name')?.textContent).toBe('Lumen.Kai');
    fire(byPart(host, 'display-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.update).toHaveBeenCalledWith({ tradeTag: 'Lumen.Kai', challenge: null });
    expect(api.go).toHaveBeenCalledWith('login');
  });

  it('must differ from the private username, ignoring case', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    type(host.querySelector<HTMLInputElement>('#trade-tag')!, 'Juniper.Oak');
    // Owner demo note #219: Continue is disabled and the reason is said at once, as quiet help.
    expect(byPart<HTMLButtonElement>(host, 'display-continue')!.disabled).toBe(true);
    expect(byPart(host, 'display-problem')?.textContent).toBe('Your Trade Tag must be different from your Login ID.');
    fire(byPart(host, 'display-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.go).not.toHaveBeenCalled();
  });

  it('refuses reserved words and wrong shapes in the board words', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    const input = host.querySelector<HTMLInputElement>('#trade-tag')!;
    const go = byPart<HTMLButtonElement>(host, 'display-continue')!;
    type(input, 'x2f-support');
    expect(go.disabled).toBe(true);
    expect(byPart(host, 'display-problem')?.textContent).toBe('That Trade Tag is kept for X2F. Pick another.');
    // A length problem waits until the field is left (owner demo note #219: no nagging mid-word).
    type(input, 'ab');
    expect(go.disabled).toBe(true);
    expect(byPart(host, 'display-problem')).toBeNull();
    fire(input, new FocusEvent('focusout', { bubbles: true }));
    expect(byPart(host, 'display-problem')?.textContent).toBe('Your Trade Tag needs 8 to 20 characters.');
    expect(input.getAttribute('aria-describedby')).toContain('trade-tag-problem');
    type(input, 'Lumen.Kai');
    expect(go.disabled).toBe(false);
    expect(byPart(host, 'display-problem')).toBeNull();
    expect(api.go).not.toHaveBeenCalled();
  });

  it('note #219: Continue is disabled while the field is empty and enabled once the name passes', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    const go = byPart<HTMLButtonElement>(host, 'display-continue')!;
    expect(go.disabled).toBe(true);
    expect(byPart(host, 'display-problem')).toBeNull();
    type(host.querySelector<HTMLInputElement>('#trade-tag')!, 'Lumen.Kai');
    expect(go.disabled).toBe(false);
  });

  it('makes no availability request (Trade Tags are checked when the account is made)', () => {
    const host = show('display', setup({ loginName: 'juniper.oak' }));
    type(host.querySelector<HTMLInputElement>('#trade-tag')!, 'Lumen.Kai');
    expect(checks()).toEqual([]);
  });
});

// Owner demo note #108 (17 Nov 2026): "Do not allow spaces in username or passwords or display
// names". Said inline as soon as a space is typed, and Continue stays on the step.
describe('note #108: no spaces in the names', () => {
  it('the username step says so as soon as a space is typed, never asks the server, and does not continue', async () => {
    const api = setup();
    const host = show('username', api);
    const input = host.querySelector<HTMLInputElement>('#uname')!;
    type(input, 'juniper oak');
    expect(byPart(host, 'name-space')?.textContent).toBe('Remove the spaces. A Login ID has no spaces.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('uname-space');
    await wait(CHECK_DELAY_MS * 2);
    expect(checks()).toEqual([]);
    // Owner demo note #196: Continue is disabled, so the click does nothing.
    expect(byPart<HTMLButtonElement>(host, 'names-continue')!.disabled).toBe(true);
    fire(byPart(host, 'names-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.go).not.toHaveBeenCalled();
    type(input, 'juniper.oak');
    expect(byPart(host, 'name-space')).toBeNull();
  });

  it('the Trade Tag step says so inline, shows no preview, and does not continue', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    const input = host.querySelector<HTMLInputElement>('#trade-tag')!;
    type(input, 'Lumen K');
    expect(byPart(host, 'display-space')?.textContent).toBe('Remove the spaces. A Trade Tag has no spaces.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(byPart(host, 'display-space')).not.toBeNull();
    // Owner demo note #219: Continue is disabled, so the click does nothing.
    expect(byPart<HTMLButtonElement>(host, 'display-continue')!.disabled).toBe(true);
    fire(byPart(host, 'display-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.go).not.toHaveBeenCalled();
    expect(host.querySelector('#trade-tag-help')?.textContent).toContain('with no spaces');
  });

  it('spaces at the ends are trimmed as before, not refused', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    type(host.querySelector<HTMLInputElement>('#trade-tag')!, '  Lumen.Kai  ');
    expect(byPart(host, 'display-space')).toBeNull();
    fire(byPart(host, 'display-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.update).toHaveBeenCalledWith({ tradeTag: 'Lumen.Kai', challenge: null });
  });
});

// Owner demo notes #196 and #197 (25 Nov 2026, the advice he pasted): a live rule checklist, a
// "Generate random" button, the input's attributes and an example placeholder.
describe('notes #196 and #197: the private login ID step', () => {
  const rule = (host: ParentNode, id: string) => host.querySelector(`#uname-rules [data-rule="${id}"]`)!;
  const states = (host: ParentNode) => ['length', 'characters', 'no-spaces'].map((id) => rule(host, id).getAttribute('data-met'));

  it('lists the rules as live rows, muted before anything is typed, with the advice as plain help', () => {
    const host = show('username', setup());
    expect([...host.querySelectorAll('#uname-rules li')].map((li) => li.firstChild?.nextSibling?.textContent)).toEqual([
      '8–20 characters',
      'Letters, numbers, dots, dashes and underscores only',
      'No spaces',
    ]);
    expect(states(host)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(rule(host, 'length').querySelector('.x2f-sr-only')?.textContent).toBe(', not yet');
    expect(host.querySelector('#uname-help')?.textContent).toBe("Pick something that isn't your real name or used elsewhere.");
    expect(host.textContent).not.toContain('8 to 20 characters: letters');
    expect(host.querySelector('#uname')?.getAttribute('aria-describedby')).toBe('uname-status uname-rules uname-help');
  });

  it('ticks each rule as it is met, and turns red only what typed text breaks', () => {
    const host = show('username', setup());
    const input = host.querySelector<HTMLInputElement>('#uname')!;
    type(input, 'abc');
    // Too short is "not yet", not red: the person is still typing.
    expect(states(host)).toEqual(['unknown', 'true', 'true']);
    type(input, 'juniper.oak');
    expect(states(host)).toEqual(['true', 'true', 'true']);
    expect(rule(host, 'length').querySelector('.x2f-sr-only')?.textContent).toBe(', met');
    type(input, 'juniper#oak');
    expect(states(host)).toEqual(['true', 'false', 'true']);
    expect(rule(host, 'characters').querySelector('.x2f-sr-only')?.textContent).toBe(', not met');
    type(input, 'juniper oak');
    expect(states(host)).toEqual(['true', 'true', 'false']);
    // Owner demo note #108's inline line stays.
    expect(byPart(host, 'name-space')?.textContent).toBe('Remove the spaces. A Login ID has no spaces.');
    expect(host.querySelector('#uname')?.getAttribute('aria-describedby')).toBe('uname-space uname-status uname-rules uname-help');
    type(input, 'a'.repeat(21));
    expect(states(host)).toEqual(['false', 'true', 'true']);
  });

  it('"Generate random" fills a valid random name, the availability check runs, and Continue goes on', async () => {
    const api = setup();
    const host = show('username', api);
    const gen = byPart<HTMLButtonElement>(host, 'name-generate')!;
    expect(gen.textContent).toBe('Generate random');
    expect(gen.classList.contains('x2f-start__textbutton')).toBe(true);
    expect(gen.hasAttribute('data-primary')).toBe(false);
    fire(gen, new MouseEvent('click', { bubbles: true }));
    const name = host.querySelector<HTMLInputElement>('#uname')!.value;
    expect(name).toMatch(/^[a-z]+_[a-z]+_[1-9][0-9]$/);
    expect(states(host)).toEqual(['true', 'true', 'true']);
    await wait(CHECK_DELAY_MS + 10);
    expect(checks().map((c) => c.body)).toEqual([{ loginName: name }]);
    expect(byPart(host, 'name-status')?.textContent).toBe(`${name} is available`);
    fire(byPart(host, 'names-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.update).toHaveBeenCalledWith({ loginName: name, challenge: null });
  });

  it('keeps autocapitalize, autocorrect and spellcheck off, and shows an example placeholder', () => {
    const input = show('username', setup()).querySelector<HTMLInputElement>('#uname')!;
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('placeholder')).toBe('e.g. midnight_otter_42');
  });

  it('the Trade Tag step uses the same strong label, still reading "Trade Tag"', () => {
    const label = show('display', setup({ loginName: 'juniper.oak' })).querySelector('label[for="trade-tag"]')!;
    expect(label.textContent).toBe('Trade Tag');
    expect(label.classList.contains('x2f-start__field-label')).toBe(true);
  });
});

// Owner demo note #199 (25 Nov 2026): the trade-tag screen is the second step, and it calls the
// private name "your Login ID".
describe('note #199: the trade-tag step', () => {
  it('says "Step 2 of 5" with two bar segments lit; the username step stays step 1', () => {
    const host = show('display', setup({ loginName: 'juniper.oak' }));
    expect(host.querySelector('.x2f-start__step')?.textContent).toBe('Step 2 of 5');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2');
    expect([...host.querySelectorAll('.x2f-start__seg')].map((s) => s.getAttribute('data-on'))).toEqual(['true', 'true', 'false', 'false', 'false']);
    expect(show('username', setup()).querySelector('.x2f-start__step')?.textContent).toBe('Step 1 of 5');
  });

  it('says "Login ID", never "username", on the step', () => {
    const host = show('display', setup({ loginName: 'juniper.oak' }));
    expect(host.querySelector('.x2f-start__lead')?.textContent).toBe('This is how traders see you. It must be different from your Login ID.');
    expect(host.textContent).not.toMatch(/username/i);
  });
});

// Owner demo notes #199 and #200 (25 Nov 2026): the trader card preview, suggestion chips, the
// permanence note and Continue in the flow.
describe('notes #199 and #200: preview, suggestions, permanence, inline Continue', () => {
  it('owner demo note #220: an established trader\'s example card, live with the name as typed, labelled as an example', () => {
    const host = show('display', setup({ loginName: 'juniper.oak' }));
    const card = byPart(host, 'trader-preview')!;
    const name = () => card.querySelector('.x2f-ident__name')!;
    // One labelled region, said to be an example.
    expect(card.tagName).toBe('SECTION');
    expect(card.getAttribute('aria-labelledby')).toBe('display-preview-h');
    expect(card.querySelector('#display-preview-h')?.textContent).toBe('What your trader card could look like');
    // Owner demo note #224: the X2F mark in place of the word "Example".
    expect(byPart(card, 'preview-example')).toBeNull();
    expect(byPart(card, 'preview-logo')?.querySelector('svg.x2f-logo')).not.toBeNull();
    // The example name while the field is empty or invalid.
    expect(name().textContent).toBe('nightowl_44');
    expect(card.getAttribute('data-example-name')).toBe('true');
    for (const bad of ['Lumen', 'Lumen Kai12', 'x2f-support']) {
      type(host.querySelector<HTMLInputElement>('#trade-tag')!, bad);
      expect(name().textContent, bad).toBe('nightowl_44');
    }
    // Exactly as typed once it passes the trade-tag rules.
    type(host.querySelector<HTMLInputElement>('#trade-tag')!, 'Lumen.Kai$');
    expect(name().textContent).toBe('Lumen.Kai$');
    expect(name().hasAttribute('data-username')).toBe(true);
    expect(card.hasAttribute('data-example-name')).toBe(false);
    expect(card.querySelector('.x2f-avatar')?.textContent).toBe('LK');
    // The real pieces: Trusted ring and online dot, the Vendor tag, member since, the kit's stat tiles.
    expect(card.querySelector('.x2f-avatar')?.getAttribute('data-trusted')).toBe('true');
    expect(card.querySelector('.x2f-ident__meta')?.textContent).toBe('Online · member since Sep 2024');
    expect(card.textContent).toContain('Vendor');
    const stats = byPart(card, 'preview-stats')!;
    expect(stats.getAttribute('role')).toBe('group');
    expect(stats.getAttribute('aria-label')).toBe('Example stats');
    expect([...stats.querySelectorAll('.x2f-stat')].map((t) => `${t.querySelector('dd')?.textContent} ${t.querySelector('dt')?.textContent}`)).toEqual([
      '248 trades',
      '99% positive',
      '86.4 XMR traded',
    ]);
    const badges = byPart(card, 'preview-badges')!;
    expect(badges.getAttribute('aria-label')).toBe('Example badges');
    expect([...badges.querySelectorAll('li > span:last-child')].map((n) => n.textContent)).toEqual(['Trusted', 'Veteran', 'Fast', 'Clean record', '100 trades', 'PGP verified']);
    for (const seal of badges.querySelectorAll('.x2f-seal')) expect(seal.getAttribute('aria-hidden')).toBe('true');
    expect([...byPart(card, 'preview-facts')!.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '~6 min typical payment time',
      'Disputes: none',
      'Account protected with PGP',
    ]);
  });

  it('offers 3 suggestions that pass the trade-tag rules and differ from the Login ID; a tap fills the box; ↻ draws new ones', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    const chips = () => [...host.querySelectorAll<HTMLButtonElement>('[data-part="display-suggestion"]')];
    const first = chips().map((c) => c.textContent!);
    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    for (const n of first) {
      expect(checkNewTradeTag(n).ok, n).toBe(true);
      expect(n.toLowerCase()).not.toBe('juniper.oak');
      expect(tracesBack(n, 'juniper.oak'), n).toBe(false);
    }
    for (const c of chips()) expect(c.hasAttribute('data-primary')).toBe(false);
    fire(chips()[1]!, new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector<HTMLInputElement>('#trade-tag')!.value).toBe(first[1]);
    expect(host.querySelector('[data-part="trader-preview"] .x2f-ident__name')?.textContent).toBe(first[1]);
    const refresh = byPart(host, 'display-suggestions-refresh')!;
    expect(refresh.getAttribute('aria-label')).toBe('More suggestions');
    expect(refresh.textContent).toBe('↻');
    fire(refresh, new MouseEvent('click', { bubbles: true }));
    expect(chips()).toHaveLength(3);
    fire(byPart(host, 'display-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.update).toHaveBeenCalledWith({ tradeTag: first[1], challenge: null });
  });

  it('says the Trade Tag is permanent, in the owner\'s sentence, under the preview', () => {
    const host = show('display', setup({ loginName: 'juniper.oak' }));
    const note = byPart(host, 'display-permanent')!;
    expect(note.textContent).toBe("Your Trade Tag is permanent—pick a handle you'll be happy building your trading reputation under.");
    expect(byPart(host, 'trader-preview')!.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts Continue in the flow right after the card on this step only (footerInline)', () => {
    const host = show('display', setup({ loginName: 'juniper.oak' }));
    const foot = byPart(host, 'display-continue')!.closest('footer')!;
    expect(foot.classList.contains('x2f-start__foot--inline')).toBe(true);
    expect(foot.parentElement?.classList.contains('x2f-start__main')).toBe(true);
    const name = show('username', setup()).querySelector('[data-part="names-continue"]')!.closest('footer')!;
    expect(name.classList.contains('x2f-start__foot--inline')).toBe(false);
    expect(name.parentElement?.classList.contains('x2f-start')).toBe(true);
  });
});

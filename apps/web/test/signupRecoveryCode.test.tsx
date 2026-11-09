// @vitest-environment happy-dom
// Owner 1 Nov 2026 (register S-017; lead job J-09): the recovery codes are required at sign-up:
// shown, ticked "I've written it down", one of them typed back (or pasted) before going on; other
// backups stay optional after that. Against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Backup } from '../src/screens/setup/Backup.js';
import { INITIAL, SetupContext, type SetupApi, type SetupState } from '../src/screens/setup/kit.js';
import { needsBackup } from '../src/screens/setup/SetupFlow.js';
import { fire, render } from './render.js';

const CODES = Array.from({ length: 10 }, (_, i) => `ABCD-EFGH-JKMN-PQ${String(i).padStart(2, '0')}`);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let route: (url: string, init: RequestInit) => Promise<Response>;

beforeEach(() => {
  route = async (url) => {
    if (url === '/v1/account/recovery-codes') return json(200, { codes: CODES });
    return json(500, { error: 'internal' });
  };
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    return route(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

const byPart = (host: ParentNode, part: string) => host.querySelector<HTMLElement>(`[data-part="${part}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

function setup(state: Partial<SetupState> = {}): SetupApi {
  return {
    state: { ...INITIAL, terms: 'v1', displayName: 'Lumen.K', loginName: 'juniper.oak', ...state },
    update: vi.fn(),
    returnTo: '/sell',
    go: vi.fn(),
    path: (s) => `/setup/${s}`,
  };
}

function show(el: React.ReactNode, api: SetupApi) {
  return render(
    <MemoryRouter>
      <SetupContext.Provider value={api}>{el}</SetupContext.Provider>
    </MemoryRouter>,
  ).host;
}

describe('S-017: the recovery codes are required at sign-up', () => {
  async function shown(api = setup({ registered: true })) {
    const host = show(<Backup />, api);
    expect(byPart(host, 'backup-skip')).toBeNull();
    click(byPart(host, 'recovery-make'));
    await flush();
    return { host, api };
  }

  const wanted = (host: HTMLElement) => Number(byPart(host, 'recovery-typeback')!.getAttribute('data-code-number'));

  it('offers no way past the step before the codes are made: no Skip, no other method', () => {
    const host = show(<Backup />, setup({ registered: true }));
    expect(byPart(host, 'backup-skip')).toBeNull();
    expect(host.querySelector('[data-backup="security-key"]')).toBeNull();
    expect(byPart(host, 'recovery-make')).not.toBeNull();
  });

  it('shows the codes numbered, and Continue waits for the tick and the typed-back code', async () => {
    const { host, api } = await shown();
    const items = [...host.querySelectorAll('[data-part="code-list"] li')].map((li) => li.textContent);
    expect(items).toEqual(CODES);
    expect(host.querySelector('[data-part="code-list"]')!.tagName).toBe('OL');
    const n = wanted(host);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(CODES.length);
    expect(host.querySelector('label[for="recovery-typeback"]')!.textContent).toBe(`Type or paste code ${n} from your list`);
    const go = byPart(host, 'recovery-continue')!;
    expect(go.hasAttribute('disabled')).toBe(true);

    // The tick alone is not enough.
    click(byPart(host, 'recovery-written'));
    expect((byPart(host, 'recovery-written') as HTMLInputElement).checked).toBe(true);
    expect(byPart(host, 'recovery-continue')!.hasAttribute('disabled')).toBe(true);

    // Another code from the list is not the one asked for.
    const other = CODES[n % CODES.length]!;
    type(host.querySelector<HTMLInputElement>('#recovery-typeback')!, other);
    expect(byPart(host, 'recovery-mismatch')!.textContent).toBe(`That is not code ${n}. Check what you wrote down.`);
    expect(byPart(host, 'recovery-continue')!.hasAttribute('disabled')).toBe(true);

    // Typed in lower case without dashes (or pasted as shown), it matches.
    type(host.querySelector<HTMLInputElement>('#recovery-typeback')!, CODES[n - 1]!.toLowerCase().replaceAll('-', ''));
    expect(byPart(host, 'recovery-mismatch')).toBeNull();
    expect(byPart(host, 'recovery-continue')!.hasAttribute('disabled')).toBe(false);
    click(byPart(host, 'recovery-continue'));
    expect(api.update).toHaveBeenCalledWith({ backup: 'recovery-codes' });
    expect(api.go).not.toHaveBeenCalled();
  });

  it('the typed-back code without the tick does not go on', async () => {
    const { host } = await shown();
    type(host.querySelector<HTMLInputElement>('#recovery-typeback')!, CODES[wanted(host) - 1]!);
    expect(byPart(host, 'recovery-continue')!.hasAttribute('disabled')).toBe(true);
  });

  it('after the codes, the other backups are optional and Skip goes on to the wallet', async () => {
    const { host, api } = await shown();
    click(byPart(host, 'recovery-written'));
    type(host.querySelector<HTMLInputElement>('#recovery-typeback')!, CODES[wanted(host) - 1]!);
    click(byPart(host, 'recovery-continue'));
    expect(host.querySelector('[data-backup="recovery-codes"]')).toBeNull();
    expect(host.querySelector('[data-backup="security-key"]')).not.toBeNull();
    expect(host.querySelector('[data-backup="pgp"]')).not.toBeNull();
    click(byPart(host, 'backup-skip'));
    expect(api.go).toHaveBeenCalledWith('wallet');
  });

  it('the wallet and welcome steps wait for the codes once the account exists', () => {
    expect(needsBackup({ ...INITIAL, registered: true, backup: null })).toBe(true);
    expect(needsBackup({ ...INITIAL, registered: true, backup: 'recovery-codes' })).toBe(false);
    // Someone already signed in who comes to link a wallet did not sign up in this flow.
    expect(needsBackup({ ...INITIAL, registered: false, backup: null })).toBe(false);
  });
});


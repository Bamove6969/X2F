// @vitest-environment happy-dom
// Owner 1 Nov 2026 (register S-017; lead job J-09): the recovery code is required at sign-up:
// shown, ticked "I've written it down", typed back (or pasted) before going on; other backups stay
// optional after that. Owner demo notes, 12 Nov 2026: one long code (hold model v3 already made
// one), and the type-back on its own screen without the code in view. Against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Backup } from '../src/screens/setup/Backup.js';
import { INITIAL, SetupContext, type SetupApi, type SetupState } from '../src/screens/setup/kit.js';
import { needsBackup } from '../src/screens/setup/SetupFlow.js';
import { Methods } from '../src/screens/settings/Methods.js';
import { RecoveryCodes } from '../src/screens/settings/RecoveryCodes.js';
import { fire, render } from './render.js';

/** The server's one code (64 symbols), and a second, different one. */
const CODES = ['0', '1'].map((d) => `${'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-'.repeat(2).slice(0, 75)}000${d}`);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let route: (url: string, init: RequestInit) => Promise<Response>;

beforeEach(() => {
  route = async (url) => {
    if (url === '/v1/account/recovery-codes') return json(200, { codes: [CODES[0]] });
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
    state: { ...INITIAL, terms: { version: 'v1' }, displayName: 'Lumen.K', loginName: 'juniper.oak', ...state },
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

describe('S-017: the recovery code is required at sign-up', () => {
  async function shown(api = setup({ registered: true })) {
    const host = show(<Backup />, api);
    expect(byPart(host, 'backup-skip')).toBeNull();
    click(byPart(host, 'recovery-make'));
    await flush();
    return { host, api };
  }

  /** Owner, 12 Nov 2026: screen A (the code, the tick, Next), then screen B (type it in unseen). */
  function toTypeBack(host: HTMLElement) {
    click(byPart(host, 'recovery-written'));
    click(byPart(host, 'recovery-next'));
    return host.querySelector<HTMLInputElement>('#recovery-typeback')!;
  }

  it('offers no way past the step before the code is made: no Skip, no other method', () => {
    const host = show(<Backup />, setup({ registered: true }));
    expect(byPart(host, 'backup-skip')).toBeNull();
    expect(host.querySelector('[data-backup="security-key"]')).toBeNull();
    expect(byPart(host, 'recovery-make')).not.toBeNull();
  });

  it('shows the one code, and going on waits for the tick and the typed-back code', async () => {
    const { host, api } = await shown();
    expect(byPart(host, 'recovery-code')!.textContent!.replace(/\s/g, '')).toBe(CODES[0]!.replaceAll('-', ''));
    expect(host.querySelector('[data-part="recovery-code"]')!.tagName).toBe('OL');
    // Without the tick there is no way to the type-back.
    expect(byPart(host, 'recovery-next')!.hasAttribute('disabled')).toBe(true);
    expect(host.querySelector('#recovery-typeback')).toBeNull();

    // The tick alone is not enough.
    const input = toTypeBack(host);
    expect(byPart(host, 'recovery-continue')!.hasAttribute('disabled')).toBe(true);

    // Another code is not this one.
    type(input, CODES[1]!);
    expect(byPart(host, 'recovery-mismatch')!.textContent).toBe('Not a match yet. Check what you wrote down.');
    expect(byPart(host, 'recovery-continue')!.hasAttribute('disabled')).toBe(true);

    // Typed in lower case without dashes (or pasted as shown), it matches.
    type(input, CODES[0]!.toLowerCase().replaceAll('-', ''));
    expect(byPart(host, 'recovery-mismatch')).toBeNull();
    expect(byPart(host, 'recovery-continue')!.hasAttribute('disabled')).toBe(false);
    click(byPart(host, 'recovery-continue'));
    expect(api.update).toHaveBeenCalledWith({ backup: 'recovery-codes' });
  });

  it('after the code, it goes straight on to the wallet: no other backup is offered (lead call, 12 Nov 2026)', async () => {
    const { host, api } = await shown();
    type(toTypeBack(host), CODES[0]!);
    click(byPart(host, 'recovery-continue'));
    expect(host.querySelector('[data-backup]')).toBeNull();
    expect(byPart(host, 'backup-skip')).toBeNull();
    expect(api.go).toHaveBeenCalledWith('wallet');
  });

  it('the wallet and welcome steps wait for the code once the account exists', () => {
    expect(needsBackup({ ...INITIAL, registered: true, backup: null })).toBe(true);
    expect(needsBackup({ ...INITIAL, registered: true, backup: 'recovery-codes' })).toBe(false);
    // Someone already signed in who comes to link a wallet did not sign up in this flow.
    expect(needsBackup({ ...INITIAL, registered: false, backup: null })).toBe(false);
  });

  it('Security settings speaks of the recovery code in the singular (owner, 12 Nov 2026 note #28)', async () => {
    route = async (url) => {
      if (url === '/v1/account/methods') {
        return json(200, [{ type: 'recovery-codes', id: 'recovery-codes', label: '', createdAt: null, lastUsedAt: null }]);
      }
      if (url === '/v1/account/recovery-codes') return json(200, { codes: [CODES[0]] });
      return json(500, { error: 'internal' });
    };
    const { host } = render(<Methods prove={async () => 'tok'} />);
    await flush();
    expect(host.querySelector('[data-method="recovery-codes"] .x2f-list__label')?.textContent).toBe('Recovery code');
    expect(host.querySelector('[data-add="recovery-codes"]')?.textContent).toBe('Create recovery code');

    const { host: rcHost } = render(<RecoveryCodes prove={async () => 'tok'} onDone={() => undefined} />);
    expect(byPart(rcHost, 'recovery-make')?.textContent).toBe('Show my recovery code');
    click(byPart(rcHost, 'recovery-make'));
    await flush();
    expect(rcHost.querySelector('.x2f-note')?.textContent).toBe('Save this now. It works once, and you will not see it again.');
    expect(byPart(rcHost, 'recovery-done')?.textContent).toBe('I have saved it');
  });
});

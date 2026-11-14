// @vitest-environment happy-dom
// Sign-up v2 (owner demo notes, 12 Nov 2026, /setup/name, /setup/login, /setup/backup): the login
// methods are ticked (several at once) and set up one after another, the recovery code comes after
// all of them; the recovery code is one long code, shown with "I've written it down" and Next, then
// typed back without seeing it (red until it matches, green when it does), and Back shows the same
// code again. Against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Backup } from '../src/screens/setup/Backup.js';
import { INITIAL, SIGNUP_ORDER, SetupContext, nextStep, type SetupApi, type SetupState } from '../src/screens/setup/kit.js';
import { Login, METHODS } from '../src/screens/setup/Login.js';
import { PgpChallenge } from '../src/screens/setup/PgpChallenge.js';
import { Username } from '../src/screens/setup/Username.js';
import { fire, render } from './render.js';

/** A 64-symbol code as the server makes them (16 groups of four). */
const CODE = 'K7M2-9QXA-4FTR-8WPN-ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-0ABC-DEFG-HJKM-NPQR';
const SIGNING = { fingerprint: '3f2a9c417b0ed5a261c80e4b92d71f6ac3b80d15', publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxjMEsigning\n-----END PGP PUBLIC KEY BLOCK-----\n' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let made = 0;

beforeEach(() => {
  made = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/v1/account/recovery-codes') {
      made += 1;
      return json(200, { codes: [CODE] });
    }
    if (url === '/v1/pgp/signing-key') return json(200, SIGNING);
    return json(500, { error: 'internal' });
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
const disabled = (el: Element | null) => el!.hasAttribute('disabled');

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

function setup(state: Partial<SetupState> = {}): SetupApi {
  return {
    state: { ...INITIAL, terms: { version: 'v1', signature: { kind: 'typed', name: 'AK' } }, displayName: 'Lumen.K', loginName: 'juniper.oak', ...state },
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

const box = (host: ParentNode, id: string) => host.querySelector<HTMLInputElement>(`[data-method="${id}"] input[type="checkbox"]`)!;

describe('/setup/name (owner, 12 Nov 2026)', () => {
  it('asks for a unique username and no longer says there is nothing else to give', () => {
    const host = show(<Username />, setup());
    expect(host.querySelector('h1')!.textContent).toBe('Pick a unique username');
    expect(host.textContent).not.toContain('Nothing else to give');
    expect(host.textContent).toContain('You type this to log in. Only you see it.');
  });
});

describe('/setup/login: tick every way you want to log in (owner, 12 Nov 2026)', () => {
  it('offers PGP, security key, passkey, authenticator app and password as checkboxes, PGP ticked first', () => {
    const host = show(<Login />, setup());
    const ids = [...host.querySelectorAll('[data-method]')].map((e) => e.getAttribute('data-method'));
    expect(ids).toEqual(['pgp', 'security-key', 'passkey', 'totp', 'password']);
    expect(host.querySelector('[role="radio"]')).toBeNull();
    for (const id of ids) expect(box(host, id!)).not.toBeNull();
    expect(box(host, 'pgp').checked).toBe(true);
    expect(box(host, 'password').checked).toBe(false);
  });

  it('labels PGP and the security key Recommended and Strong, the authenticator app Medium, the password Weak with the owner\'s warning', () => {
    const host = show(<Login />, setup());
    const chip = (id: string) => host.querySelector(`[data-method="${id}"] [data-part="strength"]`)!;
    for (const id of ['pgp', 'security-key']) {
      expect(host.querySelector(`[data-method="${id}"] [data-part="recommended"]`)!.textContent).toBe('Recommended');
      expect(chip(id).textContent).toBe('Strong');
      expect(chip(id).getAttribute('data-strength')).toBe('strong');
    }
    expect(chip('totp').textContent).toBe('Medium');
    expect(chip('password').textContent).toBe('Weak');
    expect(host.querySelector('[data-method="password"]')!.textContent).toContain(
      'It is strongly recommended you do not choose this as the only security method you use.',
    );
    // The authenticator app is there with its explanation.
    expect(host.querySelector('[data-method="totp"]')!.textContent).toMatch(/6-digit code/);
    expect(METHODS.find((m) => m.id === 'totp')!.strength).toBe('medium');
  });

  it('recommends PGP on Android too', () => {
    const host = show(<Login />, setup());
    click(byPart(host, 'pgp-explain'));
    expect(byPart(host, 'pgp-explainer')!.textContent).toMatch(/Android/);
    expect(byPart(host, 'pgp-explainer')!.textContent).toMatch(/recommend PGP/i);
  });

  // Signup round 3, lead call (13 Nov 2026): the authenticator app may be the only extra method
  // when PGP, a passkey or a security key is ticked; with none of those it still needs a password.
  it('the authenticator app goes with any way to log in: PGP alone is enough, and it unticks with the last one', () => {
    const host = show(<Login />, setup());
    // PGP is ticked by default.
    expect(box(host, 'totp').disabled).toBe(false);
    click(box(host, 'totp'));
    expect(box(host, 'totp').checked).toBe(true);
    click(box(host, 'pgp'));
    expect(box(host, 'totp').checked).toBe(false);
    expect(box(host, 'totp').disabled).toBe(true);
    expect(host.querySelector('[data-method="totp"]')!.textContent).toMatch(/tick one/i);
    for (const partner of ['security-key', 'passkey', 'password']) {
      click(box(host, partner));
      expect(box(host, 'totp').disabled).toBe(false);
      click(box(host, 'totp'));
      expect(box(host, 'totp').checked).toBe(true);
      click(box(host, partner));
      expect(box(host, 'totp').checked).toBe(false);
    }
  });

  it('PGP and the authenticator app, no password: both are stored in setup order', () => {
    const api = setup();
    const host = show(<Login />, api);
    click(box(host, 'totp'));
    click(byPart(host, 'method-continue'));
    expect(api.update).toHaveBeenCalledWith({ methods: ['pgp', 'totp'], done: [], method: 'pgp' });
  });

  it('Continue needs at least one way to log in, and stores every ticked one in setup order', () => {
    const api = setup();
    const host = show(<Login />, api);
    click(box(host, 'pgp'));
    expect(disabled(byPart(host, 'method-continue'))).toBe(true);
    click(box(host, 'password'));
    click(box(host, 'totp'));
    click(box(host, 'pgp'));
    expect(disabled(byPart(host, 'method-continue'))).toBe(false);
    click(byPart(host, 'method-continue'));
    expect(api.update).toHaveBeenCalledWith({ methods: ['pgp', 'password', 'totp'], done: [], method: 'pgp' });
    expect(api.go).toHaveBeenCalledWith('pgp-key');
  });

  it('after one is set up, the next ticked one comes; the recovery code comes after all of them', () => {
    expect(SIGNUP_ORDER).toEqual(['pgp', 'security-key', 'passkey', 'password', 'totp']);
    const s = { ...INITIAL, methods: ['pgp', 'security-key', 'password', 'totp'] as SetupState['methods'] };
    expect(nextStep({ ...s, done: [] })).toBe('pgp-key');
    expect(nextStep({ ...s, done: ['pgp'] })).toBe('security-key');
    expect(nextStep({ ...s, done: ['pgp', 'security-key'] })).toBe('password');
    expect(nextStep({ ...s, done: ['pgp', 'security-key', 'password'] })).toBe('authenticator');
    expect(nextStep({ ...s, done: ['pgp', 'security-key', 'password', 'totp'] })).toBe('backup');
    expect(nextStep({ ...INITIAL, methods: ['passkey'], done: ['passkey'] })).toBe('backup');
  });
});

describe('/setup/backup: one long recovery code, written down, then typed back unseen (owner, 12 Nov 2026)', () => {
  async function shown(api = setup({ registered: true })) {
    const host = show(<Backup />, api);
    expect(byPart(host, 'backup-skip')).toBeNull();
    click(byPart(host, 'recovery-make'));
    await flush();
    return { host, api };
  }

  it('speaks of one recovery code, never codes', async () => {
    const host = show(<Backup />, setup({ registered: true }));
    expect(host.textContent).toContain('recovery code');
    expect(host.textContent).not.toMatch(/recovery codes/i);
    click(byPart(host, 'recovery-make'));
    await flush();
    expect(host.textContent).not.toMatch(/recovery codes|these now|each works/i);
  });

  it('screen A shows the code with "I\'ve written it down" and Next, which waits for the tick; nothing to type yet', async () => {
    const { host } = await shown();
    expect(byPart(host, 'recovery-code')!.textContent!.replace(/\s/g, '')).toBe(CODE.replaceAll('-', ''));
    expect(host.querySelector('#recovery-typeback')).toBeNull();
    expect(disabled(byPart(host, 'recovery-next'))).toBe(true);
    click(byPart(host, 'recovery-written'));
    expect(disabled(byPart(host, 'recovery-next'))).toBe(false);
  });

  it('screen B hides the code, is red until the code matches and green when it does, then Next goes on', async () => {
    const { host, api } = await shown();
    click(byPart(host, 'recovery-written'));
    click(byPart(host, 'recovery-next'));
    expect(byPart(host, 'recovery-code')).toBeNull();
    expect(host.textContent).not.toContain(CODE.slice(5, 14));
    const input = host.querySelector<HTMLInputElement>('#recovery-typeback')!;
    const go = () => byPart(host, 'recovery-continue');
    expect(input.getAttribute('data-match')).toBe('empty');
    expect(disabled(go())).toBe(true);
    type(input, CODE.slice(0, 20));
    expect(input.getAttribute('data-match')).toBe('no');
    expect(disabled(go())).toBe(true);
    type(input, `${CODE.slice(0, -1)}0`);
    expect(input.getAttribute('data-match')).toBe('no');
    // Typed in lower case without dashes: the dashes go in by themselves, and it matches.
    type(input, CODE.toLowerCase().replaceAll('-', ''));
    expect(input.value).toBe(CODE);
    expect(input.getAttribute('data-match')).toBe('yes');
    expect(byPart(host, 'recovery-match')!.textContent).toBeTruthy();
    expect(disabled(go())).toBe(false);
    click(go());
    expect(api.update).toHaveBeenCalledWith({ backup: 'recovery-codes' });
    // Nothing is sent for the check: one call made the code, none checked it.
    expect(made).toBe(1);
  });

  it('dashes go in by themselves as the code is typed', async () => {
    const { host } = await shown();
    click(byPart(host, 'recovery-written'));
    click(byPart(host, 'recovery-next'));
    const input = host.querySelector<HTMLInputElement>('#recovery-typeback')!;
    type(input, 'k7m29');
    expect(input.value).toBe('K7M2-9');
  });

  it('Back returns to screen A with the same code; no new code is made', async () => {
    const { host } = await shown();
    click(byPart(host, 'recovery-written'));
    click(byPart(host, 'recovery-next'));
    type(host.querySelector<HTMLInputElement>('#recovery-typeback')!, 'WRONG');
    click(byPart(host, 'recovery-back'));
    expect(byPart(host, 'recovery-code')!.textContent!.replace(/\s/g, '')).toBe(CODE.replaceAll('-', ''));
    expect(made).toBe(1);
    // And forward again the box starts empty.
    expect(disabled(byPart(host, 'recovery-next'))).toBe(false);
    click(byPart(host, 'recovery-next'));
    expect(host.querySelector<HTMLInputElement>('#recovery-typeback')!.value).toBe('');
  });

  it('the code is kept in the flow\'s memory, so the step shown again shows the same code without making a new one', async () => {
    const api = setup({ registered: true });
    const { host } = await shown(api);
    expect(api.update).toHaveBeenCalledWith({ recoveryCode: CODE });
    host.remove();
    const again = show(<Backup />, setup({ registered: true, recoveryCode: CODE }));
    expect(byPart(again, 'recovery-make')).toBeNull();
    expect(byPart(again, 'recovery-code')!.textContent!.replace(/\s/g, '')).toBe(CODE.replaceAll('-', ''));
    expect(made).toBe(1);
  });
});

describe('lead calls, 12 Nov 2026', () => {
  it('no "Add another backup" step: the recovery code goes straight on to the wallet', async () => {
    const api = setup({ registered: true });
    const host = show(<Backup />, api);
    click(byPart(host, 'recovery-make'));
    await flush();
    click(byPart(host, 'recovery-written'));
    click(byPart(host, 'recovery-next'));
    type(host.querySelector<HTMLInputElement>('#recovery-typeback')!, CODE);
    click(byPart(host, 'recovery-continue'));
    expect(api.update).toHaveBeenCalledWith({ backup: 'recovery-codes' });
    expect(api.go).toHaveBeenCalledWith('wallet');
    expect(host.querySelector('[data-backup]')).toBeNull();
    expect(byPart(host, 'backup-skip')).toBeNull();
    expect(host.textContent).not.toContain('Add another backup');
  });

  it('a recovery code already saved in this flow opens on the wallet, never an extras step', () => {
    const api = setup({ registered: true, backup: 'recovery-codes' });
    const host = show(<Backup />, api);
    expect(host.querySelector('[data-backup]')).toBeNull();
    expect(api.go).toHaveBeenCalledWith('wallet', { replace: true });
  });

  it("the PGP code step offers X2F's signing key to import, with its fingerprint, so the message reads as signed by X2F", async () => {
    const host = show(
      <PgpChallenge />,
      setup({ challenge: { challengeId: 'c1', encryptedMessage: '-----BEGIN PGP MESSAGE-----', expiresAt: '2099-01-01T00:00:00.000Z', fingerprint: 'aa' } as SetupState['challenge'] }),
    );
    await flush();
    const part = byPart(host, 'signing-key')!;
    expect(part).not.toBeNull();
    expect(part.textContent).toContain('3F2A 9C41 7B0E D5A2 61C8  0E4B 92D7 1F6A C3B8 0D15');
    expect(part.querySelector('a')!.getAttribute('href')).toBe('/.well-known/x2f-signing-key.asc');
    expect(part.querySelector('a')!.hasAttribute('download')).toBe(true);
    expect(host.querySelector('[data-part="signing-key"] [data-primary]')).toBeNull();
  });
});

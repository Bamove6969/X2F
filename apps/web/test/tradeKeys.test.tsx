// @vitest-environment happy-dom
// Settings → Security, "Trade key backup" (escrow-key sync; tradeKeys.ts, TradeKeys.tsx): the reader
// key is wrapped only by a passkey or security key (PRF) or a PGP key, never the authenticator app;
// adding a way to unlock needs an unlock first; the last one stays; restore hands the unlocked key
// to the escrow worker. The WebAuthn PRF is faked: one fixed output per credential and salt.
import * as openpgp from 'openpgp';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { generateBoxKeyPair, type BoxKeyPair } from '@x2f/protocol';
import { KeySyncError, pgpEnvelopeText, type UnlockEnvelope } from '../src/escrow/keySync.js';
import { serveEscrow, type FromWorker, type Port } from '../src/escrow/worker.js';
import { TradeKeys } from '../src/screens/settings/TradeKeys.js';
import {
  addUnlock,
  keyChoices,
  newChoices,
  parseUnlockOptions,
  putShape,
  removeUnlock,
  setUpReader,
  unlockWithPgp,
  unlockWithPrf,
  type StoredReader,
  type TradeKeysDeps,
  type UnlockOptions,
} from '../src/screens/settings/tradeKeys.js';
import { TRADE_KEYS_COPY as K } from '../src/screens/settings/tradeKeysCopy.js';
import { fire, render } from './render.js';

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
const byPart = (host: ParentNode, part: string) => host.querySelector(`[data-part="${part}"]`);

/** A fake authenticator: PRF output = SHA-256(credential ‖ salt); `null` credentials have no PRF. */
function fakePrf(noPrf: ReadonlySet<string> = new Set()) {
  return vi.fn(async (salt: Uint8Array<ArrayBuffer>, credentialId?: string) => {
    const id = credentialId ?? 'cred-a';
    if (noPrf.has(id)) throw new KeySyncError('no-prf');
    const bytes = new Uint8Array([...new TextEncoder().encode(id), ...salt]);
    return { credentialId: id, prf: new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)) };
  });
}

let pgpKey: { publicKey: string; privateKey: string; fingerprint: string } | null = null;
async function pgp() {
  if (pgpKey === null) {
    const { privateKey, publicKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ name: 'Test' }], format: 'armored' });
    pgpKey = { privateKey, publicKey, fingerprint: (await openpgp.readKey({ armoredKey: publicKey })).getFingerprint().toUpperCase() };
  }
  return pgpKey;
}
async function decryptInOwnTool(message: string): Promise<string> {
  const { data } = await openpgp.decrypt({
    message: await openpgp.readMessage({ armoredMessage: message }),
    decryptionKeys: await openpgp.readPrivateKey({ armoredKey: (await pgp()).privateKey }),
  });
  return String(data);
}

async function options(): Promise<UnlockOptions> {
  const k = await pgp();
  return {
    keys: [
      { kind: 'passkey', label: 'Phone', credentialId: 'cred-a' },
      { kind: 'security-key', label: 'Blue key', credentialId: 'cred-b' },
    ],
    pgp: [{ fingerprint: k.fingerprint, label: k.fingerprint.slice(-16), publicKey: k.publicKey }],
  };
}

/** An in-memory `/v1/escrow-keys/reader`. */
function fakeServer(opts: UnlockOptions, prf = fakePrf()) {
  let reader: StoredReader | null = null;
  const puts: { publicKey: string; unlocks: UnlockEnvelope[] }[] = [];
  const deps: TradeKeysDeps & { readerState: () => Promise<StoredReader | 'none' | 'hidden'> } = {
    api: {
      async putReader(b) {
        puts.push(b);
        reader = { id: 'r1', publicKey: b.publicKey, unlocks: b.unlocks.map((u, i) => ({ ...u, id: `u${i}` })) };
        return { id: 'r1' };
      },
    },
    readerState: async () => reader ?? 'none',
    unlockMethods: async () => opts,
    prf,
    newReader: generateBoxKeyPair,
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  };
  return { deps, puts, reader: () => reader, prf };
}

describe('trade key backup: the steps', () => {
  it('offers passkeys, security keys and PGP keys only; the API answer is parsed strictly', async () => {
    const o = await options();
    expect(keyChoices(o).map((c) => c.method)).toEqual(['prf', 'prf', 'pgp']);
    expect(() => parseUnlockOptions({ keys: [{ kind: 'totp', label: 'App', credentialId: 'x' }], pgp: [] })).toThrow();
    expect(() => parseUnlockOptions({ keys: [] })).toThrow();
    expect(parseUnlockOptions({ keys: [], pgp: [] })).toEqual({ keys: [], pgp: [] });
  });

  it('sets up with a passkey (PRF), unlocks with it, adds a PGP key after an unlock, and never removes the last', async () => {
    const o = await options();
    const s = fakeServer(o);
    await setUpReader(keyChoices(o)[0]!, s.deps);
    const r1 = s.reader()!;
    expect(r1.unlocks.map((u) => [u.method, u.ref])).toEqual([['prf', 'cred-a']]);
    expect(r1.unlocks[0]!.salt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Nothing of the secret is sent: only the public key and the envelope.
    expect(Object.keys(s.puts[0]!).sort()).toEqual(['publicKey', 'unlocks']);

    const pair = await unlockWithPrf(r1, r1.unlocks[0]!, s.deps);
    expect(pair.boxPublic).toBe(r1.publicKey);
    // Another credential's PRF output does not open it.
    await expect(unlockWithPrf(r1, { ...r1.unlocks[0]!, ref: 'cred-b' }, s.deps)).rejects.toMatchObject({ code: 'bad-unlock' });

    const pgpChoice = newChoices(o, r1.unlocks).find((c) => c.method === 'pgp')!;
    await addUnlock(r1, pair, pgpChoice, s.deps);
    const r2 = s.reader()!;
    expect(r2.publicKey).toBe(r1.publicKey);
    expect(r2.unlocks.map((u) => u.method)).toEqual(['prf', 'pgp']);
    // The stored rows' ids are never sent back.
    expect(s.puts[1]!.unlocks.every((u) => !('id' in u))).toBe(true);
    expect(s.puts[1]!.unlocks[1]).not.toHaveProperty('salt');

    // The PGP way: decrypt in the person's own tool, paste the text back.
    const text = await decryptInOwnTool(pgpEnvelopeText(r2.unlocks[1]!));
    expect((await unlockWithPgp(r2, text)).boxPublic).toBe(r1.publicKey);
    await expect(unlockWithPgp(r2, 'not it')).rejects.toMatchObject({ code: 'bad-unlock' });

    expect(await removeUnlock(r2, r2.unlocks[0]!, s.deps)).toBe(true);
    const r3 = s.reader()!;
    expect(r3.unlocks.map((u) => u.method)).toEqual(['pgp']);
    expect(await removeUnlock(r3, r3.unlocks[0]!, s.deps)).toBe(false);
    expect(s.puts).toHaveLength(3);
  }, 30_000);

  it('a key without PRF says so; an add with a key that does not match the reader is refused', async () => {
    const o = await options();
    const s = fakeServer(o, fakePrf(new Set(['cred-b'])));
    await expect(setUpReader(keyChoices(o)[1]!, s.deps)).rejects.toMatchObject({ code: 'no-prf' });
    await setUpReader(keyChoices(o)[0]!, s.deps);
    const other = await generateBoxKeyPair();
    await expect(addUnlock(s.reader()!, other, keyChoices(o)[2]!, s.deps)).rejects.toMatchObject({ code: 'bad-unlock' });
    expect(putShape({ method: 'pgp', ref: 'F', salt: null, envelope: 'x' })).toEqual({ method: 'pgp', ref: 'F', envelope: 'x' });
  });
});

describe('trade key backup: the section', () => {
  it('Set up lists the keys and why the authenticator app is not one, then shows the unlocks; the last cannot be removed', async () => {
    const o = await options();
    const s = fakeServer(o);
    const { host } = render(<TradeKeys member={false} deps={s.deps} restore={async () => []} />);
    await settle();
    expect(byPart(host, 'trade-keys-none')?.textContent).toBe(K.none);
    fire(byPart(host, 'trade-keys-setup')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    const choices = [...host.querySelectorAll('[data-part="trade-keys-choices"] [data-choice]')].map((b) => b.textContent);
    expect(choices).toEqual(['Passkey: Phone', 'Security key: Blue key', `PGP key: ${o.pgp[0]!.label}`]);
    expect(byPart(host, 'trade-keys-no-totp')?.textContent).toBe(K.noTotp);
    expect(host.textContent).not.toMatch(/Authenticator app:/);
    fire(host.querySelector('[data-choice="prf"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(s.puts).toHaveLength(1);
    expect(byPart(host, 'trade-keys-on')?.textContent).toBe(K.on);
    expect([...host.querySelectorAll('[data-part="trade-keys-unlocks"] .x2f-list__label')].map((e) => e.textContent)).toEqual(['Passkey: Phone']);
    expect((byPart(host, 'trade-keys-remove') as HTMLButtonElement).disabled).toBe(true);
    expect(byPart(host, 'trade-keys-last')?.textContent).toBe(K.lastUnlock);
  });

  it('Restore unlocks with the passkey and hands the reader key to the worker, which stores what it opens', async () => {
    const o = await options();
    const s = fakeServer(o);
    await setUpReader(keyChoices(o)[0]!, s.deps);
    const restore = vi.fn(async (_r: BoxKeyPair) => ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH']);
    const { host } = render(<TradeKeys member={false} deps={s.deps} restore={restore} />);
    await settle();
    fire(byPart(host, 'trade-keys-restore-start')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    fire(host.querySelector('[data-part="trade-keys-restore"] [data-unlock-with="prf"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0]![0].boxPublic).toBe(s.reader()!.publicKey);
    expect(byPart(host, 'trade-keys-note')?.textContent).toBe(K.restored(2));
    // The secret is wiped once handed over.
    expect([...restore.mock.calls[0]![0].boxSecret].every((b) => b === 0)).toBe(true);
  });

  it('a member: their own reader key, no restore; a member without the box sees nothing', async () => {
    const o = await options();
    const s = fakeServer(o);
    await setUpReader(keyChoices(o)[0]!, s.deps);
    const { host } = render(<TradeKeys member={true} deps={s.deps} restore={async () => []} />);
    await settle();
    expect(byPart(host, 'trade-keys-on')).not.toBeNull();
    expect(byPart(host, 'trade-keys-restore')).toBeNull();
    const hidden = render(<TradeKeys member={true} deps={{ ...s.deps, readerState: async () => 'hidden' }} restore={async () => []} />);
    await settle();
    expect(byPart(hidden.host, 'trade-keys')).toBeNull();
  });
});

describe('escrow worker: restore-trades', () => {
  function port() {
    const out: FromWorker[] = [];
    let cb: ((e: { data: unknown }) => void) | null = null;
    const p: Port = { postMessage: (m) => out.push(m), addEventListener: (_t, f) => (cb = f) };
    return { p, out, send: (data: unknown) => cb!({ data }) };
  }

  it('answers the codes restored without a runtime, and null for a bad key or a failure', async () => {
    const pair = await generateBoxKeyPair();
    const restore = vi.fn(async (r: BoxKeyPair) => (r.boxPublic === pair.boxPublic ? ['AAAA-BBBB-CCCC-DDDD'] : Promise.reject(new Error('x'))));
    const { p, out, send } = port();
    serveEscrow(p, () => Promise.reject(new Error('no runtime')), restore);
    send({ t: 'restore-trades', id: 1, boxPublic: pair.boxPublic, boxSecret: new Uint8Array(pair.boxSecret) });
    send({ t: 'restore-trades', id: 2, boxPublic: 'nope', boxSecret: new Uint8Array(32) });
    send({ t: 'restore-trades', id: 3, boxPublic: 'a'.repeat(64), boxSecret: new Uint8Array(32) });
    await settle();
    expect(out.filter((m) => m.t === 'restored-trades').sort((a, b) => (a as { id: number }).id - (b as { id: number }).id)).toEqual([
      { t: 'restored-trades', id: 1, codes: ['AAAA-BBBB-CCCC-DDDD'] },
      { t: 'restored-trades', id: 2, codes: null },
      { t: 'restored-trades', id: 3, codes: null },
    ]);
    expect(restore).toHaveBeenCalledTimes(2);
  });
});

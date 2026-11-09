import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { type ConfirmAction, MAX_WALLET_BATCH, actionHash, addressEnd, addressEnds, addressHash, addressesHash, describeAction } from '@x2f/accounts';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('describeAction', () => {
  test.each<[ConfirmAction, string]>([
    [{ kind: 'add-wallet', addressHash: 'ab12', addressEnd: 'q2k3Fz' }, 'add payout wallet ending …q2k3Fz'],
    [{ kind: 'add-wallets', addressesHash: 'ab12', addressEnds: 'q2k3Fz,abcdef' }, 'add 2 payout wallets ending …q2k3Fz, …abcdef'],
    [{ kind: 'add-method', method: 'passkey' }, 'add a login method (passkey)'],
    [{ kind: 'remove-method', method: 'pgp', id: 'm1' }, 'remove a login method (pgp)'],
    [{ kind: 'set-password' }, 'set a new password'],
    [{ kind: 'new-recovery-codes' }, 'make new recovery codes'],
    [{ kind: 'add-device-key', signPublicHash: 'cd34' }, 'add a trade signing key'],
    [{ kind: 'team-roles', memberId: 'm1', roles: 'offers,trades' }, "change a team member's roles to Offers and Trades"],
    // Owner p4-8: the hold rights by name.
    [{ kind: 'team-roles', memberId: 'm1', roles: 'trades,hold-see,hold-end' }, "change a team member's roles to Trades, See waiting changes and End a hold"],
    [{ kind: 'team-invite', name: 'desk_ana', roles: 'hold-cancel' }, 'invite desk_ana as a team member (Untick or cancel waiting changes)'],
  ])('%j', (a, expected) => {
    expect(describeAction(a)).toBe(expected);
  });
});

describe('actionHash', () => {
  test('is async (WebCrypto)', () => {
    expect(actionHash({ kind: 'set-password' })).toBeInstanceOf(Promise);
  });

  test('independent of key order', async () => {
    const x = await actionHash({ kind: 'add-wallet', addressEnd: 'q2k3Fz', addressHash: 'ab12' });
    const y = await actionHash({ addressHash: 'ab12', addressEnd: 'q2k3Fz', kind: 'add-wallet' });
    expect(x).toBe(y);
  });

  test('changes when addressHash changes', async () => {
    const x = await actionHash({ kind: 'add-wallet', addressHash: 'ab12', addressEnd: 'q2k3Fz' });
    const y = await actionHash({ kind: 'add-wallet', addressHash: 'ab13', addressEnd: 'q2k3Fz' });
    expect(x).not.toBe(y);
  });

  test('is SHA-256 hex of canonical JSON with sorted keys', async () => {
    const a: ConfirmAction = { kind: 'remove-method', method: 'pgp', id: 'm1' };
    expect(await actionHash(a)).toBe(sha256('{"id":"m1","kind":"remove-method","method":"pgp"}'));
    expect(await actionHash({ kind: 'set-password' })).toBe(sha256('{"kind":"set-password"}'));
  });

  test('different kinds differ', async () => {
    expect(await actionHash({ kind: 'set-password' })).not.toBe(await actionHash({ kind: 'new-recovery-codes' }));
  });

  test('non-ASCII input hashes its UTF-8 bytes', async () => {
    const id = 'é\u{1F600}"\\';
    expect(await actionHash({ kind: 'remove-method', method: 'totp', id })).toBe(
      sha256(JSON.stringify({ id, kind: 'remove-method', method: 'totp' })),
    );
  });
});

describe('address helpers', () => {
  const addr = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge';

  test('addressHash is SHA-256 hex of the trimmed address', async () => {
    expect(await addressHash(`  ${addr}\n`)).toBe(sha256(addr));
  });

  test('addressEnd is the last 6 characters', () => {
    expect(addressEnd(addr)).toBe('684Rge');
    expect(addressEnd(`${addr}  `)).toBe('684Rge');
  });

  test('addressesHash binds the trimmed list in order; addressEnds joins the ends', async () => {
    const other = '4' + 'B'.repeat(94);
    expect(await addressesHash([` ${addr}`, `${other}\n`])).toBe(sha256(`${addr}\n${other}`));
    expect(await addressesHash([addr, other])).not.toBe(await addressesHash([other, addr]));
    expect(addressEnds([addr, other])).toBe('684Rge,BBBBBB');
  });
});

describe('wallet batches (owner, 2026-10-24)', () => {
  const addr = (c: string) => `4${c.repeat(94)}`;
  const batch = async (list: string[]): Promise<ConfirmAction> => ({
    kind: 'add-wallets', addressesHash: await addressesHash(list), addressEnds: addressEnds(list),
  });

  test('MAX_WALLET_BATCH is 10', () => {
    expect(MAX_WALLET_BATCH).toBe(10);
  });

  test('a full batch of 10 is described with all 10 ends', async () => {
    const list = Array.from({ length: MAX_WALLET_BATCH }, (_, i) => addr('123456789A'[i]!));
    const text = describeAction(await batch(list));
    expect(text).toBe(`add 10 payout wallets ending ${list.map((a) => `…${addressEnd(a)}`).join(', ')}`);
  });

  test('an empty list hashes the empty string and has no ends (the API refuses it before any token)', async () => {
    expect(await addressesHash([])).toBe(sha256(''));
    expect(addressEnds([])).toBe('');
  });

  test('a duplicate address in one list is kept as given: the hash differs from the list without it', async () => {
    const a = addr('A');
    const b = addr('B');
    expect(await addressesHash([a, a, b])).toBe(sha256(`${a}\n${a}\n${b}`));
    expect(await addressesHash([a, a, b])).not.toBe(await addressesHash([a, b]));
    expect(addressEnds([a, a])).toBe('AAAAAA,AAAAAA');
  });

  test('the action for list A never matches the action for list B, another order or a sublist', async () => {
    const [a, b, c] = [addr('A'), addr('B'), addr('C')];
    const forA = await actionHash(await batch([a, b]));
    for (const other of [[a, c], [b, a], [a], [a, b, c]]) {
      expect(await actionHash(await batch(other)), other.map(addressEnd).join(',')).not.toBe(forA);
    }
    expect(await actionHash(await batch([` ${a}`, `${b}\n`]))).toBe(forA);
  });

  test('a one-wallet batch never matches the single-wallet action for the same address', async () => {
    const a = addr('A');
    const single: ConfirmAction = { kind: 'add-wallet', addressHash: await addressHash(a), addressEnd: addressEnd(a) };
    expect(await actionHash(await batch([a]))).not.toBe(await actionHash(single));
  });
});

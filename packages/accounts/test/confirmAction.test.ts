import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { type ConfirmAction, actionHash, addressEnd, addressEnds, addressHash, addressesHash, describeAction } from '@x2f/accounts';

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

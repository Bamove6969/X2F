import { describe, expect, it } from 'vitest';
import { MAX_WALLET_BATCH } from '@x2f/accounts';
import { parseConfirmAction } from '../src/auth/actionInput.js';
import { ApiError } from '../src/errors.js';

const HASH = 'a'.repeat(64);
const ends = (n: number) => Array.from({ length: n }, (_, i) => `${'123456789A'[i % 10]}bcdef`).join(',');

function refused(raw: unknown): void {
  let caught: unknown;
  try {
    parseConfirmAction(raw);
  } catch (e) {
    caught = e;
  }
  expect(caught, JSON.stringify(raw)).toBeInstanceOf(ApiError);
  expect((caught as ApiError).status).toBe(400);
  expect((caught as ApiError).code).toBe('bad-request');
}

describe('parseConfirmAction: add-wallets (owner, 2026-10-24)', () => {
  it('accepts 1 to MAX_WALLET_BATCH (10) address ends', () => {
    expect(MAX_WALLET_BATCH).toBe(10);
    for (const n of [1, 2, MAX_WALLET_BATCH]) {
      const raw = { kind: 'add-wallets', addressesHash: HASH, addressEnds: ends(n) };
      expect(parseConfirmAction(raw)).toEqual(raw);
    }
  });

  it('accepts short ends (an address shorter than 6 characters ends in all of it)', () => {
    expect(parseConfirmAction({ kind: 'add-wallets', addressesHash: HASH, addressEnds: 'a,bc,def' })).toMatchObject({ addressEnds: 'a,bc,def' });
  });

  it('accepts the same end twice: two addresses may share an end (the route refuses a repeated address)', () => {
    expect(parseConfirmAction({ kind: 'add-wallets', addressesHash: HASH, addressEnds: 'abcdef,abcdef' })).toMatchObject({
      addressEnds: 'abcdef,abcdef',
    });
  });

  it('refuses an empty batch and more than 10', () => {
    refused({ kind: 'add-wallets', addressesHash: HASH, addressEnds: '' });
    refused({ kind: 'add-wallets', addressesHash: HASH, addressEnds: ends(MAX_WALLET_BATCH + 1) });
    refused({ kind: 'add-wallets', addressesHash: HASH, addressEnds: ends(50) });
  });

  it('refuses malformed ends: empty parts, too long, not base58, spaces', () => {
    for (const bad of [',', 'abcdef,', ',abcdef', 'abc,,def', 'abcdefg', 'abcdef,abcdefg', 'abc0ef', 'abcOef', 'abcIef', 'abclef', 'abc def', 'abc, def', 'abc;def']) {
      refused({ kind: 'add-wallets', addressesHash: HASH, addressEnds: bad });
    }
  });

  it('refuses a hash that is not 64 lowercase hex characters', () => {
    for (const bad of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)]) {
      refused({ kind: 'add-wallets', addressesHash: bad, addressEnds: 'abcdef' });
    }
  });

  it('refuses missing, extra, mixed-up or non-string fields', () => {
    refused({ kind: 'add-wallets', addressesHash: HASH });
    refused({ kind: 'add-wallets', addressEnds: 'abcdef' });
    refused({ kind: 'add-wallets', addressesHash: HASH, addressEnds: 'abcdef', extra: 'x' });
    refused({ kind: 'add-wallets', addressHash: HASH, addressEnd: 'abcdef' });
    refused({ kind: 'add-wallet', addressesHash: HASH, addressEnds: 'abcdef' });
    refused({ kind: 'add-wallets', addressesHash: HASH, addressEnds: ['abcdef'] });
    refused({ kind: 'add-wallets', addressesHash: HASH, addressEnds: 1 });
  });
});

describe('parseConfirmAction: team roles', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  it('accepts any non-empty set of roles in the fixed order', () => {
    for (const roles of ['offers', 'trades', 'offers,trades']) {
      expect(parseConfirmAction({ kind: 'team-roles', memberId: ID, roles })).toMatchObject({ roles });
      expect(parseConfirmAction({ kind: 'team-invite', name: 'desk_ana', roles })).toMatchObject({ roles });
    }
  });

  it('refuses unknown roles, repeats, the wrong order and an empty list', () => {
    for (const roles of ['', 'admin', 'trades,offers', 'offers,offers', 'hold-see', 'offers,hold-end', 'offers,', ',offers']) refused({ kind: 'team-roles', memberId: ID, roles });
  });
});

/**
 * A team member's device and the account's trade escrow keys (owner Jess, 26 Nov 2026: members the
 * lead grants a box may act in the account's trades, each its own box: `trades-fund`,
 * `trades-release`, `trades-upload-proof`, `trades-mark-paid`).
 *
 * The keys reach the member the way they reach a new device of the holder (keySync.ts): the
 * holder's escrow worker seals each trade's copy to every reader the API lists, a member with
 * "Hold trade keys" (`trades-escrow-keys`) among them. On the member's device the member unlocks
 * their OWN reader key (their passkey or security key's PRF output, or their PGP key; never an
 * authenticator code or a recovery code: neither makes a key) and `restoreTrades` stores the copies
 * in this device's escrow store. Only then does the trade room start the escrow here.
 *
 * Nothing here signs: the escrow runtime does, after the room's confirm-it's-you step for a fund or
 * a release (`fund-trade`, `release-trade`), and the API checks the member's box on every event.
 */
import type { BoxKeyPair } from '@x2f/protocol';
import { normalizeTradeCode } from '@x2f/core';
import type { EscrowStore } from './store.js';
import type { EscrowClient } from './useEscrow.js';

/** The box that makes a member a reader of the account's trade keys ("Hold trade keys"). */
export const MEMBER_KEYS_BOX = 'trades-escrow-keys';

/** Whether `store` holds trade `code` (the worker side of `holds-trade`). */
export async function storeHolds(store: Pick<EscrowStore, 'codes'>, raw: string): Promise<boolean> {
  const code = normalizeTradeCode(raw);
  if (code === null) return false;
  return (await store.codes()).includes(code);
}

/** Whether this device's escrow store holds trade `code`; false when the client cannot say. */
export async function deviceHolds(client: Pick<EscrowClient, 'holdsTrade'>, code: string): Promise<boolean> {
  if (client.holdsTrade === undefined) return false;
  return client.holdsTrade(code).catch(() => false);
}

export type MemberLoad = 'loaded' | 'not-in-copy' | 'failed';

/**
 * Restores the account's trade copies sealed to the member's unlocked reader key into this
 * device's escrow store, and says whether trade `code` is now held. The secret is wiped after.
 */
export async function loadMemberTrade(client: Pick<EscrowClient, 'restoreTrades' | 'holdsTrade'>, code: string, reader: BoxKeyPair): Promise<MemberLoad> {
  if (client.restoreTrades === undefined) return 'failed';
  let codes: string[] | null;
  try {
    codes = await client.restoreTrades(reader);
  } catch {
    codes = null;
  } finally {
    reader.boxSecret.fill(0);
  }
  if (codes === null) return 'failed';
  const own = normalizeTradeCode(code);
  if (own !== null && codes.includes(own)) return 'loaded';
  return (await deviceHolds(client, code)) ? 'loaded' : 'not-in-copy';
}

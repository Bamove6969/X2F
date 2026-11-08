import type { EscrowEngine, PartyArgs, PartyHandle, PartyState, PartyStore, Transport } from '@x2f/escrow';
import type { Identity } from '@x2f/protocol';
import { modPartyArgs, type ModPartyArgs } from '@x2f/trade';
import { loadEscrow, saveEscrow, type Queryable } from './keystore.js';

/**
 * The moderator party's I/O (Plan 3 Task 9): Plan 1's escrow party run as `mod` on
 * `channelFor(code, 'escrow')` (never the trade code), with the attested participants and the
 * trade's R27 wallet password, over the relay, with its PartyState sealed in `mod_escrow_state`.
 * The arguments are checked by `modPartyArgs` before anything is built.
 */
export interface PartyIO {
  /** The relay's public WebSocket URL (the party joins it like a trader). */
  relayUrl: string;
  engine: EscrowEngine;
  /** Plan 1's `runParty` (tests pass a recorder). */
  run: (a: PartyArgs) => PartyHandle;
  /** Plan 1's `wsTransport` (tests pass a recorder). */
  transport: (a: { url: string; code: string; role: 'mod'; me: Identity }) => Transport;
}

/** The escrow PartyState store for one trade: sealed under MOD_KEYSTORE_KEY, bound to the trade code. */
export function escrowStore(db: Queryable, keystoreKey: Uint8Array, trade: string): PartyStore {
  return {
    load: () => loadEscrow<PartyState>(db, keystoreKey, trade),
    save: (s) => saveEscrow(db, keystoreKey, trade, s),
  };
}

export async function startModParty(a: ModPartyArgs, io: PartyIO, db: Queryable, keystoreKey: Uint8Array): Promise<PartyHandle> {
  const { args } = await modPartyArgs(a, {
    transport: (channel) => io.transport({ url: io.relayUrl, code: channel, role: 'mod', me: a.me }),
    engine: io.engine,
    store: escrowStore(db, keystoreKey, a.trade),
  });
  return io.run(args);
}

/** The production I/O: monero-ts and the relay, loaded only when the first party starts. */
export async function defaultPartyIO(o: { relayUrl: string; network: 'regtest' | 'stagenet' | 'mainnet' }): Promise<PartyIO> {
  const escrow = await import('@x2f/escrow');
  return {
    relayUrl: o.relayUrl,
    engine: new escrow.MoneroMultisigEngine({ network: o.network }),
    run: escrow.runParty,
    transport: escrow.wsTransport,
  };
}

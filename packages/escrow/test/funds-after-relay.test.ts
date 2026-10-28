// funds() after the relay connection ended for good (Plan 3 Task 12 review, Important 1): the
// relay closes a trade's channels when the trade ends (4404), which kills the party's messaging.
// The device must still read its own wallet to apply its after-close rules. No regtest: a fake
// engine and a fake transport.
import { generateIdentity, type Identity, type Participants } from '@x2f/protocol';
import { describe, expect, it } from 'vitest';
import { PartyError, TransportClosedError, runParty, type EscrowEngine, type EscrowSession, type PartyStore, type Transport } from '../src/index.js';
import { memoryStore } from './harness.js';

function fakeSession(funds: { balance: bigint; unlocked: bigint }): EscrowSession & { closed: boolean } {
  const s = {
    closed: false,
    prepare: async () => 'prepare-hex',
    save: async () => ({ v: 1 as const, keys: 'k', cache: 'c' }),
    sync: async () => ({ ...funds }),
    incoming: async () => [],
    close: async () => {
      s.closed = true;
    },
  };
  return s as unknown as EscrowSession & { closed: boolean };
}

/** A transport whose next() can be made to reject for good, like wsTransport after 4404. */
function deadTransport(): Transport & { die(code: number): void } {
  let dead: TransportClosedError | null = null;
  const waiters: ((e: TransportClosedError) => void)[] = [];
  return {
    send: () => {},
    next: () =>
      new Promise((_resolve, reject) => {
        if (dead) reject(dead);
        else waiters.push(reject);
      }),
    onReconnect: () => {},
    close: () => {},
    die(code) {
      dead = new TransportClosedError(code);
      for (const w of waiters.splice(0)) w(dead);
    },
  };
}

async function party(session: EscrowSession, transport: Transport, store: PartyStore = memoryStore()) {
  const ids: Record<'buyer' | 'seller' | 'mod', Identity> = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  const participants: Participants = {
    buyer: { signPublic: ids.buyer.signPublic, boxPublic: ids.buyer.boxPublic },
    seller: { signPublic: ids.seller.signPublic, boxPublic: ids.seller.boxPublic },
    mod: { signPublic: ids.mod.signPublic, boxPublic: ids.mod.boxPublic },
  };
  const engine: EscrowEngine = { create: async () => session, resume: async () => session };
  return runParty({ role: 'seller', trade: 'T', me: ids.seller, participants, transport, engine, daemonUri: 'http://node.test', password: 'pw', store, resendMs: 50 });
}

describe('funds() after the relay closed the trade', () => {
  it('still reads the wallet after a fatal relay close (4404); ready() and settle() report the close; stop() ends the reads', async () => {
    const funds = { balance: 7n, unlocked: 7n };
    const session = fakeSession(funds);
    const transport = deadTransport();
    const p = await party(session, transport);
    expect(await p.funds()).toMatchObject({ balance: 7n, unlocked: 7n });
    transport.die(4404);
    await expect(p.ready()).rejects.toBeInstanceOf(TransportClosedError);
    // Messaging is over, the wallet is not: the balance is read again (and sees the change).
    funds.balance = 0n;
    funds.unlocked = 0n;
    expect(await p.funds()).toMatchObject({ balance: 0n, unlocked: 0n, incoming: [] });
    await expect(p.settle({ kind: 'release', to: [{ address: 'A', amountAtomic: 1n }], builder: 'seller', cosigner: 'buyer' })).rejects.toBeInstanceOf(TransportClosedError);
    await p.stop();
    expect(session.closed).toBe(true);
    await expect(p.funds()).rejects.toMatchObject({ code: 'stopped' });
  });

  it('a party-level failure (PartyError) still rejects funds(), so the app sees it: a bad saved state', async () => {
    const session = fakeSession({ balance: 1n, unlocked: 1n });
    const store = memoryStore();
    store.set({ v: 2 as never, session: { v: 1, keys: 'k', cache: 'c' }, guard: { trade: 'T', seen: {} }, seq: 0, step: 'msig.prepare:0', address: null, sent: {}, received: {}, release: null });
    const p = await party(session, deadTransport(), store);
    await expect(p.ready()).rejects.toMatchObject({ code: 'bad-state' });
    const e = await p.funds().then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(PartyError);
    expect((e as PartyError).code).toBe('bad-state');
    await p.stop();
  });
});

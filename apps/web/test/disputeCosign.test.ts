// RetoSwap/Haveno review 2026-11-12, finding 2 (lead call): a trader's device co-signs a dispute
// payout only after checking it against the moderation service's signed ruling statement (pinned
// key, this trade, this device's own escrow address, round 1, this side the winner, and the payout
// set this device works out itself); the API's unsigned "disputed" view is never enough. The
// runtime asks for the statement while the view says disputed and hands the moderator-built
// release to its party only through cosignPolicy.
import { escrowPlan, rulingStatementBytes, type RulingStatement } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { afterEach, describe, expect, it } from 'vitest';
import { ADDR, AMOUNT, CODE, ESCROW_ADDRESS, Hub, Parties, device, funded, makeApi, modKey, tradeView, until, type ApiState, type Device } from './escrow-helpers.js';

const running: Device[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((d) => d.runtime.stopAll()));
});

async function setup() {
  const mod = await modKey();
  const state: ApiState = { identities: {}, view: tradeView() };
  const api = await makeApi(mod, state);
  const hub = new Hub();
  const parties = new Parties();
  const mk = async (role: 'buyer' | 'seller') => {
    const d = await device(role, { api: api.forRole(role), hub, parties, modPublic: mod.publicHex });
    running.push(d);
    return d;
  };
  return { mod, state, parties, mk };
}

const BALANCE = escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' }).sellerFundsAtomic;

function signed(secret: Uint8Array, over: Partial<RulingStatement> = {}): { statement: RulingStatement; sig: string } {
  const statement: RulingStatement = {
    v: 1, trade: CODE, escrowAddress: ESCROW_ADDRESS, round: 1, rulingId: '7f0c1f9e-0000-4000-8000-000000000001',
    outcome: 'refund-to-seller', winner: 'seller', payouts: [{ address: ADDR.seller, amountAtomic: BALANCE.toString() }],
    issuedAt: '2026-11-12T10:00:00.000Z', ...over,
  };
  return { statement, sig: sodium.to_hex(sodium.crypto_sign_detached(rulingStatementBytes(statement), secret)) };
}

const modBuilt = (p: Parties, role: 'buyer' | 'seller') => p.settles.filter((x) => x.role === role && x.o.builder === 'mod');

describe('the dispute co-sign on the device (Haveno review finding 2)', () => {
  it('nothing on the API\'s "disputed" alone, nor on a forged, replayed, stale or altered statement; the verified one is co-signed by the winner only', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirAddress != null && (await buyer.store.load(CODE))?.theirAddress != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'disputed' });
    await t.parties.ticks('seller', 3);
    expect(modBuilt(t.parties, 'seller')).toEqual([]);
    await sodium.ready;
    const forger = sodium.crypto_sign_keypair();
    for (const bad of [
      signed(forger.privateKey),
      signed(t.mod.secret, { trade: 'ZZ12-CD34-EF56-GH78' }),
      signed(t.mod.secret, { escrowAddress: '5AnotherEscrow' }),
      signed(t.mod.secret, { round: 2 }),
      signed(t.mod.secret, { payouts: [{ address: ADDR.seller, amountAtomic: (BALANCE - 1n).toString() }, { address: '4Elsewhere', amountAtomic: '1' }] }),
    ]) {
      t.state.ruling = bad;
      await t.parties.ticks('seller', 3);
      expect(modBuilt(t.parties, 'seller'), JSON.stringify(bad.statement)).toEqual([]);
    }
    t.state.ruling = signed(t.mod.secret);
    await until(() => modBuilt(t.parties, 'seller').length > 0);
    expect(modBuilt(t.parties, 'seller')[0]!.o).toEqual({ kind: 'release', to: [{ address: ADDR.seller, amountAtomic: BALANCE }], builder: 'mod', cosigner: 'seller' });
    await t.parties.ticks('buyer', 3);
    expect(modBuilt(t.parties, 'buyer')).toEqual([]);
  });
});

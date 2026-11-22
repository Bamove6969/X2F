// peerRelease (ruling-winner reasons, lead 22 Nov): what the moderator's party has heard from a
// trader about settling, read only. A ruling's winner whose party is committed to another outcome
// never exports for the mod-built ruling set; the moderation process tells staff why it waits from
// this read alone: the winner's own signed release messages, never the API's or a trader's word.
// No regtest: a fake engine, a saved state past setup, and frames sealed by real trade identities.
import { ROLES, type Role } from '@x2f/core';
import { generateIdentity, seal, type Identity, type Participants } from '@x2f/protocol';
import { describe, expect, it } from 'vitest';
import { releaseTag, runParty, type EscrowEngine, type EscrowSession, type Outcome, type PartyHandle, type PartyState } from '../src/index.js';
import { memoryStore } from './harness.js';

const TRADE = 'T';
const RULING: Outcome = { kind: 'release', to: [{ address: 'BUYER', amountAtomic: 90n }, { address: 'FEE', amountAtomic: 10n }], builder: 'mod', cosigner: 'buyer' };
const CANCEL: Outcome = { kind: 'release', to: [{ address: 'SELLER', amountAtomic: 100n }], builder: 'buyer', cosigner: 'mod' };

function fakeSession(): EscrowSession & { imported: string[][] } {
  const s = {
    imported: [] as string[][],
    prepare: async () => 'prepare-hex',
    save: async () => ({ v: 1 as const, keys: 'k', cache: 'c' }),
    sync: async () => ({ balance: 100n, unlocked: 100n }),
    incoming: async () => [],
    importState: async (hex: string[]) => {
      s.imported.push(hex);
    },
    close: async () => {},
  };
  return s as unknown as EscrowSession & { imported: string[][] };
}

/** A transport fed by the test; what the party sends is dropped. */
function feed() {
  const queue: unknown[] = [];
  const waiters: Array<(v: unknown) => void> = [];
  return {
    transport: {
      send: () => {},
      next: () => new Promise<unknown>((resolve) => (queue.length > 0 ? resolve(queue.shift()) : waiters.push(resolve))),
      onReconnect: () => {},
      close: () => {},
    },
    push(f: unknown) {
      const w = waiters.shift();
      if (w) w(f);
      else queue.push(f);
    },
  };
}

/** The moderator's party past setup, holding the ruling as its release (it built nothing: phase export). */
async function modParty(): Promise<{ p: PartyHandle; ids: Record<Role, Identity>; participants: Participants; push: (f: unknown) => void; ignored: string[]; session: ReturnType<typeof fakeSession> }> {
  const ids = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await generateIdentity()] as const))) as Record<Role, Identity>;
  const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  const store = memoryStore();
  const rulingTag = releaseTag(RULING);
  const saved: PartyState = {
    v: 1,
    session: { v: 1, keys: 'k', cache: 'c' },
    guard: { trade: TRADE, seen: {} },
    seq: 0,
    step: 'msig.addr:0',
    address: 'ESCROW',
    sent: { 'msig.ready:0': { address: 'ESCROW' }, [`state.export:${rulingTag}.1`]: { hex: 'mod-export' } },
    received: {},
    // The digest is the tag's source; only its first 16 hex are ever compared.
    release: { outcome: `${rulingTag}${'0'.repeat(48)}`, part: 'builder', counterpart: 'buyer', attempt: 1, phase: 'export' },
  };
  store.set(saved);
  const session = fakeSession();
  const engine: EscrowEngine = { create: async () => session, resume: async () => session };
  const f = feed();
  const ignored: string[] = [];
  const p = runParty({ role: 'mod', trade: TRADE, me: ids.mod, participants, transport: f.transport, engine, daemonUri: 'http://node.test', password: 'pw', store, resendMs: 60_000, onIgnored: (r) => ignored.push(r) });
  return { p, ids, participants, push: f.push, ignored, session };
}

let seq = 100;
const frame = (from: Role, ids: Record<Role, Identity>, participants: Participants, key: string, payload: Record<string, string>) =>
  seal({ trade: TRADE, from, seq: seq++, type: key.split(':')[0]!, payload: { key, ...payload }, to: ['mod'], me: ids[from], participants });

describe('peerRelease: what the moderator heard from a trader about settling (read only)', () => {
  it('names the other outcome a trader built and sent the moderator, by its tag, and that it carried a tx set', async () => {
    const { p, ids, participants, push, ignored } = await modParty();
    expect(p.peerRelease!('buyer')).toEqual({ current: false, elsewhere: null });
    const tag = releaseTag(CANCEL);
    push(await frame('buyer', ids, participants, `state.export:${tag}.1`, { hex: 'buyer-export' }));
    await expect.poll(() => p.peerRelease!('buyer')?.elsewhere?.tag ?? null).toBe(tag);
    expect(p.peerRelease!('buyer')).toMatchObject({ current: false, elsewhere: { tag, txSet: false } });
    // Its set: the buyer built that outcome, so its party is committed to it.
    push(await frame('buyer', ids, participants, `release.txset:${tag}.1`, { txSet: 'buyer-set' }));
    await expect.poll(() => p.peerRelease!('buyer')?.elsewhere?.txSet ?? null).toBe(true);
    // A resend of the export alone keeps what the set showed.
    push(await frame('buyer', ids, participants, `state.export:${tag}.1`, { hex: 'buyer-export' }));
    await expect.poll(() => ignored.filter((r) => r === 'not-current-release').length).toBe(3);
    expect(p.peerRelease!('buyer')).toMatchObject({ elsewhere: { tag, txSet: true } });
    expect(typeof p.peerRelease!('buyer')!.elsewhere!.at).toBe('number');
    // Nothing of it was kept, imported or acted on, and it is the buyer's only.
    expect(p.peerRelease!('seller')).toEqual({ current: false, elsewhere: null });
    await p.stop();
  });

  it('review R3: a set counts for its own tag only; a message for another tag starts again without it', async () => {
    const { p, ids, participants, push } = await modParty();
    const tag = releaseTag(CANCEL);
    push(await frame('buyer', ids, participants, `release.txset:${tag}.1`, { txSet: 'buyer-set' }));
    await expect.poll(() => p.peerRelease!('buyer')?.elsewhere?.txSet ?? null).toBe(true);
    const other = releaseTag({ ...CANCEL, to: [{ address: 'SELLER2', amountAtomic: 100n }] });
    expect(other).not.toBe(tag);
    push(await frame('buyer', ids, participants, `state.export:${other}.1`, { hex: 'buyer-export-2' }));
    await expect.poll(() => p.peerRelease!('buyer')?.elsewhere?.tag ?? null).toBe(other);
    expect(p.peerRelease!('buyer')!.elsewhere!.txSet).toBe(false);
    await p.stop();
  });

  it('a message of the current release from that trader counts as current (its export for the ruling)', async () => {
    const { p, ids, participants, push } = await modParty();
    push(await frame('buyer', ids, participants, `state.export:${releaseTag(RULING)}.1`, { hex: 'buyer-ruling-export' }));
    await expect.poll(() => p.peerRelease!('buyer')?.current ?? null).toBe(true);
    expect(p.peerRelease!('buyer')!.elsewhere).toBeNull();
    // The seller sent nothing.
    expect(p.peerRelease!('seller')).toEqual({ current: false, elsewhere: null });
    await p.stop();
  });

  it('a frame not signed by that trader is never counted (a forged sender, or another trade identity)', async () => {
    const { p, ids, participants, push, ignored } = await modParty();
    const stranger = await generateIdentity();
    const tag = releaseTag(CANCEL);
    // Signed by a key that is not the buyer's attested trade identity.
    push(await seal({ trade: TRADE, from: 'buyer', seq: seq++, type: 'release.txset', payload: { key: `release.txset:${tag}.1`, txSet: 'x' }, to: ['mod'], me: stranger, participants: { ...participants, buyer: { signPublic: stranger.signPublic, boxPublic: stranger.boxPublic } } }));
    await expect.poll(() => ignored.length).toBeGreaterThan(0);
    expect(ignored).not.toContain('not-current-release');
    expect(p.peerRelease!('buyer')).toEqual({ current: false, elsewhere: null });
    // The seller sending a set tagged for the buyer's outcome is the seller's, never the buyer's.
    push(await frame('seller', ids, participants, `release.txset:${tag}.1`, { txSet: 'y' }));
    await expect.poll(() => p.peerRelease!('seller')?.elsewhere?.txSet ?? null).toBe(true);
    expect(p.peerRelease!('buyer')).toEqual({ current: false, elsewhere: null });
    await p.stop();
  });
});

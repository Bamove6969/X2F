// Plan 3 Task 9: the moderator party's I/O wrapper (startModParty) and its sealed escrow store.
import { randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import type { EscrowEngine, PartyArgs, PartyHandle, PartyState, Transport } from '@x2f/escrow';
import { generateIdentity } from '@x2f/protocol';
import { channelFor, type ModPartyArgs } from '@x2f/trade';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { escrowStore, startModParty } from '../src/main.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

let db: pg.Pool;
const keystoreKey = new Uint8Array(randomBytes(32));

beforeAll(async () => {
  const name = `x2f_mod_p_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: `${inject('modPgUrl')}/postgres` });
  await admin.connect();
  try {
    await admin.query(`create database ${name} template ${MOD_TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  db = new pg.Pool({ connectionString: `${inject('modPgUrl')}/${name}`, max: 2 });
});

afterAll(async () => {
  await db.end();
});

async function args(): Promise<ModPartyArgs> {
  const me = await generateIdentity();
  const peer = async () => {
    const i = await generateIdentity();
    return { signPublic: i.signPublic, boxPublic: i.boxPublic };
  };
  return {
    trade: newTradeCode(),
    role: 'mod',
    me,
    participants: { buyer: await peer(), seller: await peer(), mod: { signPublic: me.signPublic, boxPublic: me.boxPublic } },
    password: 'ab'.repeat(32),
    daemonUri: 'http://127.0.0.1:1',
    feeWallet: '5'.repeat(95),
    terms: {
      deal: { poster: 'seller', takeAmountAtomic: '1', currency: 'USD', centsPerXmr: '1', maxFiatCents: '1' },
      payWindowMin: 90,
      buyerPayout: '4'.padEnd(95, 'B'),
      sellerRefund: '8'.padEnd(95, 'S'),
    },
  };
}

describe('startModParty', () => {
  it('runs the escrow party as mod on the escrow channel (never the trade code), over a transport joined to that channel', async () => {
    const a = await args();
    const runs: PartyArgs[] = [];
    const joins: Array<{ url: string; code: string; role: string }> = [];
    const transport = {} as Transport;
    const handle = {} as PartyHandle;
    const engine = {} as EscrowEngine;
    const got = await startModParty(
      a,
      {
        relayUrl: 'ws://relay.test',
        engine,
        run: (p) => {
          runs.push(p);
          return handle;
        },
        transport: (t) => {
          joins.push({ url: t.url, code: t.code, role: t.role });
          expect(t.me).toBe(a.me);
          return transport;
        },
      },
      db,
      keystoreKey,
    );
    const channel = await channelFor(a.trade, 'escrow');
    expect(got).toBe(handle);
    expect(joins).toEqual([{ url: 'ws://relay.test', code: channel, role: 'mod' }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ role: 'mod', trade: channel, password: a.password, transport, engine, participants: a.participants });
    expect(runs[0]!.trade).not.toBe(a.trade);
  });

  it('refuses keys that are not the attested mod slot before starting anything', async () => {
    const a = await args();
    let ran = false;
    const bad = { ...a, participants: { ...a.participants, mod: a.participants.buyer } };
    await expect(
      startModParty(bad, { relayUrl: 'ws://x', engine: {} as EscrowEngine, run: () => ((ran = true), {} as PartyHandle), transport: () => ({}) as Transport }, db, keystoreKey),
    ).rejects.toThrow(RangeError);
    expect(ran).toBe(false);
  });
});

describe('escrowStore', () => {
  it('seals the party state under the keystore key, bound to the trade (a row moved to another trade fails to open)', async () => {
    const code = newTradeCode();
    const other = newTradeCode();
    const state = { v: 1, session: { v: 1, keys: 'S2VZUw==', cache: 'Q0FDSEU=' }, seq: 3 } as unknown as PartyState;
    const store = escrowStore(db, keystoreKey, code);
    expect(await store.load()).toBeNull();
    await store.save(state);
    expect(await store.load()).toEqual(state);
    const { rows } = await db.query<{ sealed: Buffer }>('select sealed from mod_escrow_state where trade = $1', [code]);
    expect(rows[0]!.sealed.includes(Buffer.from('S2VZUw=='))).toBe(false);
    await db.query('insert into mod_escrow_state (trade, sealed) values ($1, $2)', [other, rows[0]!.sealed]);
    await expect(escrowStore(db, keystoreKey, other).load()).rejects.toThrow();
  });
});

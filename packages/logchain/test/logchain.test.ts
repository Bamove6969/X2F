// Plan 4 Task 14: the activity log's hash chain, shared by the API (which appends and verifies it)
// and the moderation process (which checkpoints and verifies it through its read-only role).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chainHash, verifyChain, type ChainReader, type ChainRow, type LogRowFields } from '../src/index.js';

const row = (id: string, prev: Buffer | null, over: Partial<LogRowFields> = {}): ChainRow => {
  const f: LogRowFields = { id, at: new Date(`2026-11-12T12:00:0${id}.000Z`), actorKind: 'system', actorId: null, actorRole: null, tradeCode: null, action: 'site.stopped', detail: '{}', ...over };
  return { ...f, prevHash: prev, hash: chainHash(prev, f) };
};

function chain(n: number): ChainRow[] {
  const out: ChainRow[] = [];
  for (let i = 1; i <= n; i++) out.push(row(String(i), out.at(-1)?.hash ?? null));
  return out;
}

const reader = (rows: ChainRow[]): ChainReader => ({
  row: async (id) => rows.find((r) => r.id === id) ?? null,
  after: async (id, limit) => rows.filter((r) => BigInt(r.id) > BigInt(id)).slice(0, limit),
});

describe('chainHash', () => {
  it('is SHA-256 of the previous hash and "id|at|actor_kind|actor_id|actor_role|trade_code|action|detail" (the migration trigger\'s formula)', () => {
    const prev = Buffer.alloc(32, 7);
    const f: LogRowFields = { id: '42', at: new Date('2026-11-12T12:00:00.123Z'), actorKind: 'staff', actorId: 'a1', actorRole: 'mod', tradeCode: 'ABCD2345EFGH6789', action: 'ruling.executed', detail: '{"x":1}' };
    const want = createHash('sha256').update(prev).update('42|2026-11-12T12:00:00.123Z|staff|a1|mod|ABCD2345EFGH6789|ruling.executed|{"x":1}', 'utf8').digest();
    expect(chainHash(prev, f).equals(want)).toBe(true);
    expect(chainHash(null, { ...f, actorId: null, actorRole: null, tradeCode: null }).equals(createHash('sha256').update('42|2026-11-12T12:00:00.123Z|staff||||ruling.executed|{"x":1}', 'utf8').digest())).toBe(true);
  });
});

describe('verifyChain', () => {
  it('accepts an intact chain from the start or from a checkpoint, and names its head', async () => {
    const rows = chain(5);
    expect(await verifyChain(reader(rows), undefined, 2)).toEqual({ ok: true, head: { id: '5', hash: rows[4]!.hash.toString('hex') } });
    expect(await verifyChain(reader(rows), { id: '2', hash: rows[1]!.hash.toString('hex') }, 2)).toMatchObject({ ok: true, head: { id: '5' } });
  });

  it('finds an edited row, a removed row, and a checkpoint whose row no longer has its hash', async () => {
    const rows = chain(4);
    const edited = rows.map((r) => (r.id === '3' ? { ...r, detail: '{"forged":true}' } : r));
    expect(await verifyChain(reader(edited))).toEqual({ ok: false, brokenAt: '3' });
    expect(await verifyChain(reader(rows.filter((r) => r.id !== '2')))).toEqual({ ok: false, brokenAt: '3' });
    expect(await verifyChain(reader(rows), { id: '2', hash: 'f'.repeat(64) })).toEqual({ ok: false, brokenAt: '2' });
    expect(await verifyChain(reader(rows), { id: '9', hash: rows[0]!.hash.toString('hex') })).toEqual({ ok: false, brokenAt: '9' });
  });
});

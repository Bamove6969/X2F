/**
 * The one-time prekeys X2F used, per recipient device, across outbox passes (lead follow-up to the
 * OMEMO interop run of 2026-11-10, step 4b; migration 335). A pass's `PreKeyLedger` already keeps
 * one pass from using a prekey twice; this record keeps the next pass from using one again while the
 * client stays offline and its published bundle still lists it.
 *
 * Each send loads the record of every device it is about to encrypt to, seeds the ledger with it,
 * encrypts, and writes back what the ledger then holds, in one transaction under an advisory lock
 * per recipient (two API processes never pick from the same record at once). Reconciled against the
 * fetched bundle on every load: an id the bundle no longer lists is dropped (the client used it and
 * republished; it can never be picked again anyway), and a record whose identity key differs (a
 * reinstalled client under the same device id) starts empty. A record with no id left is deleted.
 *
 * Ids only. A record is found by an HMAC of the address and device id and checked against an HMAC
 * that adds the identity key, under a subkey of X2F_JABBER_KEYS (HKDF info `x2f/jabber-prekeys`).
 * It is looked up under every key of the ring and rewritten under the current one, so a key
 * rotation keeps it; a record under a key removed from the ring is not found, and the device's
 * prekeys are then picked as if none had been used (the 30-day purge removes it).
 */
import { createHmac, hkdfSync } from 'node:crypto';
import type pg from 'pg';
import type { PreKeyLedger, RecipientBundle } from '@x2f/omemo';
import type { Keyring } from '../config.js';
import type { RetentionJob } from '../retention.js';

/** A record not written for this long is dropped (`purgeJabberPreKeys`). */
export const PREKEY_RECORD_RETENTION_MS = 30 * 86_400_000;

/** Runs one encryption against the record of `to`'s devices (see the file header). */
export interface PreKeyStore {
  withRecord<T>(to: string, bundles: RecipientBundle[], ledger: PreKeyLedger, encrypt: () => T): Promise<T>;
}

const subkeys = new WeakMap<Keyring, Map<number, Buffer>>();
function subkeyOf(ring: Keyring, id: number): Buffer {
  let m = subkeys.get(ring);
  if (!m) subkeys.set(ring, (m = new Map()));
  let k = m.get(id);
  if (!k) m.set(id, (k = Buffer.from(hkdfSync('sha256', ring.keys.get(id)!, new Uint8Array(0), 'x2f/jabber-prekeys', 32))));
  return k;
}
const tag = (key: Buffer, ...parts: Array<string | Buffer>) => {
  const h = createHmac('sha256', key);
  for (const p of parts) {
    const b = typeof p === 'string' ? Buffer.from(p, 'utf8') : p;
    h.update(Buffer.from([b.length >> 8, b.length & 0xff])).update(b);
  }
  return h.digest();
};
const deviceTag = (key: Buffer, to: string, b: RecipientBundle) => tag(key, 'device', to, String(b.deviceId));
const identityTag = (key: Buffer, to: string, b: RecipientBundle) => tag(key, 'identity', to, String(b.deviceId), b.identityKey);

export function dbPreKeyStore(db: pg.Pool, ring: Keyring, clock: () => Date): PreKeyStore {
  return {
    async withRecord<T>(to: string, bundles: RecipientBundle[], ledger: PreKeyLedger, encrypt: () => T): Promise<T> {
      const keyIds = [ring.current, ...[...ring.keys.keys()].filter((id) => id !== ring.current)];
      const current = subkeyOf(ring, ring.current);
      const c = await db.connect();
      try {
        await c.query('begin');
        await c.query('select pg_advisory_xact_lock(hashtextextended($1, 335))', [tag(current, 'recipient', to).toString('hex')]);
        // Each device's tags under every key of the ring, the current one first.
        const devices = bundles.map((b) => ({ b, tags: keyIds.map((id) => deviceTag(subkeyOf(ring, id), to, b)) }));
        const { rows } = await c.query<{ device_tag: Buffer; identity_tag: Buffer; prekey_ids: number[] }>(
          'select device_tag, identity_tag, prekey_ids from jabber_omemo_prekeys where device_tag = any($1)',
          [devices.flatMap((d) => d.tags)],
        );
        for (const { b, tags } of devices) {
          const listed = new Set(b.preKeys.map((p) => p.id));
          for (const [i, t] of tags.entries()) {
            const row = rows.find((r) => r.device_tag.equals(t));
            if (row && row.identity_tag.equals(identityTag(subkeyOf(ring, keyIds[i]!), to, b))) {
              ledger.seed(to, b, row.prekey_ids.filter((id) => listed.has(id)));
            }
          }
        }
        let result: T;
        try {
          result = encrypt();
        } finally {
          // Written back whatever the encryption did: the ledger gave back every prekey it did not use.
          const now = clock();
          for (const { b, tags } of devices) {
            const listed = new Set(b.preKeys.map((p) => p.id));
            const ids = ledger.usedIds(to, b).filter((id) => listed.has(id)).sort((x, y) => x - y);
            await c.query('delete from jabber_omemo_prekeys where device_tag = any($1)', [tags]);
            if (ids.length === 0) continue;
            await c.query(
              'insert into jabber_omemo_prekeys (device_tag, identity_tag, prekey_ids, updated_at) values ($1, $2, $3, $4)',
              [tags[0], identityTag(current, to, b), ids, now],
            );
          }
          await c.query('commit');
        }
        return result;
      } catch (e) {
        await c.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

export const purgeJabberPreKeys: RetentionJob = {
  name: 'purgeJabberPreKeys',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const r = await db.query('delete from jabber_omemo_prekeys where updated_at <= $1', [new Date(now.getTime() - PREKEY_RECORD_RETENTION_MS)]);
    return r.rowCount ?? 0;
  },
};

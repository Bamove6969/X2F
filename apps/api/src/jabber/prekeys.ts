/**
 * The one-time prekeys X2F used, per recipient device, across outbox passes (lead follow-up to the
 * OMEMO interop run of 2026-11-10, step 4b; migration 335). A pass's `PreKeyLedger` already keeps
 * one pass from using a prekey twice; this record keeps the next pass from using one again while the
 * client stays offline and its published bundle still lists it.
 *
 * Each send loads the records of the recipient, seeds the ledger with those of the devices it is
 * about to encrypt to, encrypts, and writes back what the ledger then holds, in one transaction
 * under an advisory lock per recipient, whatever key the ring puts first (two API processes never pick from the same record at once).
 * Reconciled against the fetched bundle on every load: an id the bundle no longer lists is dropped
 * (the client used it and republished; it can never be picked again anyway), unless the answer is
 * partial (review R4: fewer prekeys than the record last saw and no new id, as a cut answer or one
 * whose keys did not all parse would be), when the record is kept whole. A record whose
 * identity key differs (a reinstalled client under the same device id) is replaced. A record with
 * no id left is deleted.
 *
 * Only the ids are plain. A record is found by `recipientTag`, an HMAC of the address under a
 * subkey of X2F_JABBER_KEYS (HKDF info `x2f/jabber-prekeys`), looked up under every key of the
 * ring; the device id and identity key it is for are sealed under X2F_JABBER_KEYS. A send rewrites
 * the records it touches under the current key, and `npm run rewrap-jabber` (rewrap.ts) re-tags and
 * reseals the rest for every address it opens, so removing an old key afterwards loses none. A
 * record it cannot match to an address stays as it is and ages out (`purgeJabberPreKeys`).
 */
import { createHash, createHmac, hkdfSync } from 'node:crypto';
import type pg from 'pg';
import type { PreKeyLedger, RecipientBundle } from '@x2f/omemo';
import { keyringBox, type SecretBox } from '../auth/keystore.js';
import type { Keyring } from '../config.js';
import type { RetentionJob } from '../retention.js';

/**
 * A record not written for this long is dropped (`purgeJabberPreKeys`). Review R5: a device offline
 * longer than this with its bundle unchanged could be sent a prekey it will consume when it reads an
 * older message, so the window is long (180 days, not 30). Every send to a device rewrites its
 * record, so only a recipient X2F has not written to for that long loses it. Chosen over keeping a
 * record while the device is in the user's last device list, which X2F does not store.
 */
export const PREKEY_RECORD_RETENTION_MS = 180 * 86_400_000;

/** Runs one encryption against the record of `to`'s devices (see the file header). */
export interface PreKeyStore {
  withRecord<T>(to: string, bundles: RecipientBundle[], ledger: PreKeyLedger, encrypt: () => T): Promise<T>;
}

/** The sealed device's binding: the row's recipient tag, so a blob cannot be moved to another recipient's row. */
export const preKeyContext = (recipientTag: Buffer) => `x2f/jabber-prekeys/${recipientTag.toString('hex')}`;

const subkeys = new WeakMap<Keyring, Map<number, Buffer>>();
function subkeyOf(ring: Keyring, id: number): Buffer {
  let m = subkeys.get(ring);
  if (!m) subkeys.set(ring, (m = new Map()));
  let k = m.get(id);
  if (!k) m.set(id, (k = Buffer.from(hkdfSync('sha256', ring.keys.get(id)!, new Uint8Array(0), 'x2f/jabber-prekeys', 32))));
  return k;
}

/** HMAC-SHA-256 of the address under key `keyId`'s subkey: the only form the address has in the table. */
export const recipientTag = (ring: Keyring, keyId: number, jid: string): Buffer => createHmac('sha256', subkeyOf(ring, keyId)).update(jid, 'utf8').digest();
/** `recipientTag` under every key of the ring, the current one first. */
export const recipientTags = (ring: Keyring, jid: string): Buffer[] =>
  [ring.current, ...[...ring.keys.keys()].filter((id) => id !== ring.current)].map((id) => recipientTag(ring, id, jid));

/**
 * The advisory lock for an address (review R3): from the address under a fixed, non-secret label,
 * not from a ring key, so two processes whose rings put different keys first (during a rotation)
 * still take the same lock. Only a 64-bit hash of it reaches Postgres (`pg_locks`).
 */
const lockKey = (jid: string) => createHash('sha256').update('x2f/jabber-prekeys-lock\0').update(jid, 'utf8').digest('hex');

/** The sealed device: its id (4 bytes, big-endian) and its identity key in wire form. */
const deviceBytes = (b: RecipientBundle) => {
  const id = Buffer.alloc(4);
  id.writeUInt32BE(b.deviceId);
  return Buffer.concat([id, b.identityKey]);
};

export function dbPreKeyStore(db: pg.Pool, ring: Keyring, clock: () => Date): PreKeyStore {
  const box: SecretBox = keyringBox(ring);
  return {
    async withRecord<T>(to: string, bundles: RecipientBundle[], ledger: PreKeyLedger, encrypt: () => T): Promise<T> {
      const tags = recipientTags(ring, to);
      const current = tags[0]!;
      const c = await db.connect();
      try {
        await c.query('begin');
        await c.query('select pg_advisory_xact_lock(hashtextextended($1, 335))', [lockKey(to)]);
        const { rows } = await c.query<{ id: string; recipient_tag: Buffer; device_sealed: Buffer; prekey_ids: number[]; listed_ids: number[] }>(
          'select id, recipient_tag, device_sealed, prekey_ids, listed_ids from jabber_omemo_prekeys where recipient_tag = any($1)',
          [tags],
        );
        // Each row's device, opened; a row that does not open (a removed key) is left alone.
        const opened = rows.flatMap((r) => {
          try {
            const d = Buffer.from(box.open(r.device_sealed, preKeyContext(r.recipient_tag)));
            return d.length >= 4 ? [{ id: r.id, deviceId: d.readUInt32BE(0), device: d, ids: r.prekey_ids, listed: r.listed_ids }] : [];
          } catch {
            return [];
          }
        });
        /** Per device, the record kept as it is because this fetch is partial (review R4). */
        const kept = new Map<RecipientBundle, { ids: number[]; listed: number[] }>();
        for (const b of bundles) {
          const listed = new Set(b.preKeys.map((p) => p.id));
          const mine = deviceBytes(b);
          for (const r of opened) {
            if (!r.device.equals(mine)) continue;
            // Fewer prekeys than last seen and none new: a cut or partly unparsable answer, not a republish.
            if (listed.size < r.listed.length && [...listed].every((id) => r.listed.includes(id))) kept.set(b, r);
            ledger.seed(to, b, r.ids.filter((id) => listed.has(id)));
          }
        }
        let result: T;
        try {
          result = encrypt();
        } finally {
          // Written back whatever the encryption did: the ledger gave back every prekey it did not use.
          const now = clock();
          for (const b of bundles) {
            const listed = new Set(b.preKeys.map((p) => p.id));
            const record = kept.get(b);
            const ids = [...new Set([...ledger.usedIds(to, b).filter((id) => listed.has(id)), ...(record?.ids ?? [])])].sort((x, y) => x - y);
            const known = record ? record.listed : [...listed].sort((x, y) => x - y);
            // The device's earlier records, under any identity key (a changed key replaces them) and any ring key.
            const stale = opened.filter((r) => r.deviceId === b.deviceId).map((r) => r.id);
            if (stale.length > 0) await c.query('delete from jabber_omemo_prekeys where id = any($1)', [stale]);
            if (ids.length === 0) continue;
            await c.query('insert into jabber_omemo_prekeys (recipient_tag, device_sealed, prekey_ids, listed_ids, updated_at) values ($1, $2, $3, $4, $5)', [
              current, box.seal(deviceBytes(b), preKeyContext(current)), ids, known, now,
            ]);
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

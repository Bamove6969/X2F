/**
 * Review M4: `npm run rewrap-jabber -w @x2f/api` reseals every blob under X2F_JABBER_KEYS that is
 * not yet under the current key: each proven and pending address (`jabber_contacts`), each queued
 * notice's copy (`jabber_outbox`) and X2F's OMEMO identity key and bundle (`jabber_omemo_identity`). Run it
 * after putting a new key first, and again, before removing an old key: only once a re-run reports
 * `{"rewrapped":0,"failed":0}` is no blob left under the old one.
 *
 * Resealing an address is not a change of address, so the transaction sets `x2f.jabber_rewrap`
 * and migration 332's `jabber_contact_changed` queues no notice for it. Each row is written only if
 * it still holds the blob that was read, so a change in between wins. A blob that does not open is
 * left as it is and counted in `failed` (its user sees "needs setting up again" and sets it up
 * again). Returns counts only, never an address.
 */
import type pg from 'pg';
import { keyringBox } from '../auth/keystore.js';
import type { Config } from '../config.js';
import { addressContext } from './address.js';
import { BUNDLE_CONTEXT, IDENTITY_CONTEXT } from './omemo.js';

export async function rewrapJabberSecrets(deps: { db: pg.Pool; config: Pick<Config, 'jabberKeys'> }): Promise<{ rewrapped: number; failed: number }> {
  const ring = deps.config.jabberKeys;
  if (ring === null) throw new Error('config: X2F_JABBER_KEYS is missing');
  const box = keyringBox(ring);
  let rewrapped = 0;
  let failed = 0;
  /** The blob resealed under the current key; null when it already is, or does not open (counted). */
  const reseal = (blob: Buffer, context: string): Buffer | null => {
    if (box.isCurrent(blob)) return null;
    try {
      return box.seal(box.open(blob, context), context);
    } catch {
      failed++;
      return null;
    }
  };

  const c = await deps.db.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('x2f.jabber_rewrap', 'on', true)");
    const contacts = await c.query<{ account_id: string; jid_sealed: Buffer | null; pending_sealed: Buffer | null }>(
      'select account_id, jid_sealed, pending_sealed from jabber_contacts',
    );
    for (const row of contacts.rows) {
      for (const col of ['jid_sealed', 'pending_sealed'] as const) {
        const old = row[col];
        if (old === null) continue;
        const sealed = reseal(old, addressContext(row.account_id));
        if (sealed === null) continue;
        const r = await c.query(`update jabber_contacts set ${col} = $3 where account_id = $1 and ${col} = $2`, [row.account_id, old, sealed]);
        rewrapped += r.rowCount ?? 0;
      }
    }
    const queued = await c.query<{ id: string; account_id: string; jid_sealed: Buffer }>('select id, account_id, jid_sealed from jabber_outbox');
    for (const row of queued.rows) {
      const sealed = reseal(row.jid_sealed, addressContext(row.account_id));
      if (sealed === null) continue;
      const r = await c.query('update jabber_outbox set jid_sealed = $3 where id = $1 and jid_sealed = $2', [row.id, row.jid_sealed, sealed]);
      rewrapped += r.rowCount ?? 0;
    }
    const identity = await c.query<{ identity_public: Buffer; identity_sealed: Buffer; bundle_sealed: Buffer | null }>(
      'select identity_public, identity_sealed, bundle_sealed from jabber_omemo_identity',
    );
    for (const row of identity.rows) {
      const hex = row.identity_public.toString('hex');
      const sealed = reseal(row.identity_sealed, `${IDENTITY_CONTEXT}/${hex}`);
      if (sealed !== null) {
        const r = await c.query('update jabber_omemo_identity set identity_sealed = $2 where identity_sealed = $1', [row.identity_sealed, sealed]);
        rewrapped += r.rowCount ?? 0;
      }
      if (row.bundle_sealed === null) continue;
      const bundle = reseal(row.bundle_sealed, `${BUNDLE_CONTEXT}/${hex}`);
      if (bundle === null) continue;
      const r = await c.query('update jabber_omemo_identity set bundle_sealed = $2 where bundle_sealed = $1', [row.bundle_sealed, bundle]);
      rewrapped += r.rowCount ?? 0;
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
  return { rewrapped, failed };
}

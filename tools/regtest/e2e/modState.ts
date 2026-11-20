/**
 * Gap 4 review M1 (20 Nov): the message keys the moderator's escrow party has received for a trade,
 * read from its sealed state in the moderation database (`mod_escrow_state`, under the run's
 * keystore key). A spec uses it to act at one protocol step: the seller's tx set has reached the
 * moderator, which has not yet signed, submitted or sent its DONE. Here, not in apps/web, because no
 * apps/web file may load the moderation service's code (tools/separation-check.ts).
 */
import pg from 'pg';
import { loadEscrow } from '../../../apps/moderation/src/keystore.js';

export async function modReceivedKeys(s: { modDatabaseUrl: string; modKeystoreKey: string }, code: string): Promise<string[]> {
  const c = new pg.Client({ connectionString: s.modDatabaseUrl });
  await c.connect();
  try {
    const state = await loadEscrow<{ received?: Record<string, unknown> }>(c, new Uint8Array(Buffer.from(s.modKeystoreKey, 'base64')), code);
    return Object.keys(state?.received ?? {});
  } finally {
    await c.end();
  }
}

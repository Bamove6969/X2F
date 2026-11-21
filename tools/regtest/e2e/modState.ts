/**
 * Gap 4 review M1 (20 Nov): the message keys the moderator's escrow party has received for a trade,
 * read from its sealed state in the moderation database (`mod_escrow_state`, under the run's
 * keystore key). A spec uses it to act at one protocol step: the seller's tx set has reached the
 * moderator, which has not yet signed, submitted or sent its DONE. Here, not in apps/web, because no
 * apps/web file may load the moderation service's code (tools/separation-check.ts).
 */
import pg from 'pg';
import { loadEscrow } from '../../../apps/moderation/src/keystore.js';

/**
 * True once the moderator holds everything it needs to co-sign the seller-built release it is on
 * now: the seller's export AND tx set for its current attempt, and it has not signed yet. (A tx set
 * alone is not enough: an attempt the moderator refused moves both to the next one, and the
 * seller's device must still send that attempt's export.)
 */
export async function modHoldsSellerSet(s: { modDatabaseUrl: string; modKeystoreKey: string }, code: string): Promise<boolean> {
  const c = new pg.Client({ connectionString: s.modDatabaseUrl });
  await c.connect();
  try {
    type State = { received?: Record<string, Record<string, unknown>>; release?: { outcome: string; attempt: number; phase: string } | null };
    const st = await loadEscrow<State>(c, new Uint8Array(Buffer.from(s.modKeystoreKey, 'base64')), code);
    const rel = st?.release;
    if (!rel) return false;
    const tag = `${rel.outcome.slice(0, 16)}.${rel.attempt}`;
    const from = (k: string) => st?.received?.[k]?.seller !== undefined;
    return from(`state.export:${tag}`) && from(`release.txset:${tag}`) && (rel.phase === 'export' || rel.phase === 'cosigning');
  } finally {
    await c.end();
  }
}

// Plan 3 Task 37: the trader-to-trader block, as the web calls it. `POST /v1/account/blocks`
// (Task 26), `GET /v1/account/blocks` and `DELETE /v1/account/blocks/:tradeTag` (Task 37), all
// by the PUBLIC Trade Tag. The list is parsed strictly, so a renamed field fails loudly.
import { api } from '../../api/client.js';

/** One person I blocked (only my own blocks are ever answered; who blocked me never is). */
export interface BlockedEntry {
  tradeTag: string;
  blockedAt: string;
  /** S-093 (owner p7-6): my own private note on them; null for none (and from an older API). */
  note: string | null;
}

/** S-093: a note's most characters, as the API allows (apps/api nudge/routes.ts BLOCK_NOTE_MAX). */
export const BLOCK_NOTE_MAX = 500;

export function parseBlocked(raw: unknown): BlockedEntry[] {
  if (!Array.isArray(raw)) throw new Error('blocks: not a list');
  return raw.map((e: unknown) => {
    const r = e as Record<string, unknown> | null;
    if (r === null || typeof r !== 'object' || typeof r.tradeTag !== 'string' || typeof r.blockedAt !== 'string') {
      throw new Error('blocks: bad entry');
    }
    const note = r.note ?? null;
    if (note !== null && typeof note !== 'string') throw new Error('blocks: bad note');
    return { tradeTag: r.tradeTag, blockedAt: r.blockedAt, note };
  });
}

export async function fetchBlocked(signal?: AbortSignal): Promise<BlockedEntry[]> {
  return parseBlocked(await api<unknown>('/v1/account/blocks', signal ? { signal } : {}));
}

export async function blockTrader(tradeTag: string): Promise<void> {
  await api('/v1/account/blocks', { method: 'POST', body: { tradeTag } });
}

export async function unblockTrader(tradeTag: string): Promise<void> {
  await api(`/v1/account/blocks/${encodeURIComponent(tradeTag)}`, { method: 'DELETE' });
}

/** S-093: sets or clears (blank text is sent as null) my private note on someone I blocked; answers the stored note. */
export async function setBlockNote(tradeTag: string, text: string): Promise<string | null> {
  const note = text.trim() === '' ? null : text;
  const r = await api<{ note: string | null }>(`/v1/account/blocks/${encodeURIComponent(tradeTag)}/note`, { method: 'PUT', body: { note } });
  return r.note ?? null;
}

// Plan 3 Task 37: the trader-to-trader block, as the web calls it. `POST /v1/account/blocks`
// (Task 26), `GET /v1/account/blocks` and `DELETE /v1/account/blocks/:displayName` (Task 37), all
// by the PUBLIC display name. The list is parsed strictly, so a renamed field fails loudly.
import { api } from '../../api/client.js';

/** One person I blocked (only my own blocks are ever answered; who blocked me never is). */
export interface BlockedEntry {
  displayName: string;
  blockedAt: string;
}

export function parseBlocked(raw: unknown): BlockedEntry[] {
  if (!Array.isArray(raw)) throw new Error('blocks: not a list');
  return raw.map((e: unknown) => {
    const r = e as Record<string, unknown> | null;
    if (r === null || typeof r !== 'object' || typeof r.displayName !== 'string' || typeof r.blockedAt !== 'string') {
      throw new Error('blocks: bad entry');
    }
    return { displayName: r.displayName, blockedAt: r.blockedAt };
  });
}

export async function fetchBlocked(signal?: AbortSignal): Promise<BlockedEntry[]> {
  return parseBlocked(await api<unknown>('/v1/account/blocks', signal ? { signal } : {}));
}

export async function blockTrader(displayName: string): Promise<void> {
  await api('/v1/account/blocks', { method: 'POST', body: { displayName } });
}

export async function unblockTrader(displayName: string): Promise<void> {
  await api(`/v1/account/blocks/${encodeURIComponent(displayName)}`, { method: 'DELETE' });
}

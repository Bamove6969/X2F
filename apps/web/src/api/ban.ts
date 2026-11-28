/**
 * Plan 4 Task 27: `GET /v1/account/ban`, the ban notice's read (apps/api staff/bans.ts). Owner, 28 Nov
 * 2026: three ban tiers, read from the ban's kind and end (no field of their own):
 *
 * - `trade`: a Trade ban (kind `trade`, timed or not): no new trades; trades already started finish;
 *   the rest of the account works.
 * - `suspension`: a Suspension (kind `site` with an end): no normal login until it is lifted
 *   automatically at `until`; what is already under way can still be finished.
 * - `lifetime`: a Lifetime ban (kind `site`, no end): a permanent site ban.
 */
import { BAN_REASON_TEXT, type BanReasonCode } from '../ui/cantDoCodes.js';
import { api } from './client.js';

export type BanTier = 'trade' | 'suspension' | 'lifetime';

export interface BanInForce {
  kind: 'trade' | 'site';
  /** The general reason; null when this app does not know the code (the notice says a generic line). */
  reasonCode: BanReasonCode | null;
  until: string | null;
  permanent: boolean;
  /** When the ban was placed (its `created_at`); absent from an older API. */
  implementedAt?: string;
}

export interface BanNotice {
  bans: BanInForce[];
  /** Review S1: under a site ban, the trades still to finish (newest first); absent from an older API. */
  unfinished?: Array<{ code: string; dispute: boolean }>;
  contacts: { moderatorUrl: string | null; matrixUrl: string | null; telegramUrl: string | null };
}

/** The tier a ban in force is (owner, 28 Nov 2026). */
export function banTier(b: Pick<BanInForce, 'kind' | 'until'>): BanTier {
  if (b.kind === 'trade') return 'trade';
  return b.until === null ? 'lifetime' : 'suspension';
}

const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const isoTime = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const link = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function parseBan(raw: unknown): BanInForce | null {
  const b = rec(raw);
  if (b === null || (b.kind !== 'trade' && b.kind !== 'site')) return null;
  // An unknown reason keeps the ban: dropping it would leave an empty notice, and the notice route
  // would send the person home, where the API's 403 `banned` sends them back (client.ts).
  const reasonCode = typeof b.reasonCode === 'string' && Object.hasOwn(BAN_REASON_TEXT, b.reasonCode) ? (b.reasonCode as BanReasonCode) : null;
  const until = b.until === null ? null : isoTime(b.until);
  if (until === null && b.until !== null) return null;
  const implementedAt = isoTime(b.implementedAt);
  return {
    kind: b.kind,
    reasonCode,
    until,
    permanent: until === null,
    ...(implementedAt !== null ? { implementedAt } : {}),
  };
}

/** The notice as the API sent it, keeping only well-formed bans (an unreadable `implementedAt` is dropped). */
export function parseBanNotice(raw: unknown): BanNotice {
  const r = rec(raw) ?? {};
  const bans = (Array.isArray(r.bans) ? r.bans : []).map(parseBan).filter((b): b is BanInForce => b !== null);
  const c = rec(r.contacts);
  const unfinished = Array.isArray(r.unfinished)
    ? r.unfinished.flatMap((u) => {
        const x = rec(u);
        return x && typeof x.code === 'string' ? [{ code: x.code, dispute: x.dispute === true }] : [];
      })
    : undefined;
  return {
    bans,
    ...(unfinished !== undefined ? { unfinished } : {}),
    contacts: { moderatorUrl: link(c?.moderatorUrl), matrixUrl: link(c?.matrixUrl), telegramUrl: link(c?.telegramUrl) },
  };
}

export async function fetchBanNotice(): Promise<BanNotice> {
  return parseBanNotice(await api<unknown>('/v1/account/ban'));
}

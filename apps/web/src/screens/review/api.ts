// Plan 5 Task 6: the web's calls to the reviews API (Task 3, apps/api/src/reviews/routes.ts) and
// the platform feedback route (Task 4, apps/api/src/feedback/mood.ts). Nothing here carries an
// amount, an account id or a time beyond what the routes already answer.
import type { ReviewInput } from '@x2f/reputation';
import { ApiCallError, api } from '../../api/client.js';

/** A review as the API shows it (`PublicReview`): no reviewer, no amount, a month-and-year age. */
export interface PublicReviewView {
  neutral: boolean;
  stars: number | null;
  phrases: string[];
  tradeBadges?: string[];
  note: string | null;
  method?: string;
  age?: string;
}

/** `GET /v1/trades/:code/review` (participant). */
export interface TradeReviewView {
  /** This side may still rate or skip this trade. */
  reviewable: boolean;
  mine: PublicReviewView | null;
  theirs: PublicReviewView | null;
  /** This side skipped (the other side's skip is never shown). */
  skipped: boolean;
  /** R-011: an appeal is pending, so the other side's review is withheld. */
  held: boolean;
}

export interface PendingReview {
  code: string;
  /** The other trader's public display name. */
  counterparty: string;
  reviewableSince: string;
}

const tradePath = (code: string) => `/v1/trades/${encodeURIComponent(code)}/review`;

export async function fetchTradeReview(code: string, signal?: AbortSignal): Promise<TradeReviewView> {
  return api<TradeReviewView>(tradePath(code), signal ? { signal } : {});
}

/** `POST /v1/trades/:code/review` → 201. The reviewer's side and the subject come from the server. */
export async function postReview(code: string, body: ReviewInput): Promise<void> {
  await api(tradePath(code), { method: 'POST', body });
}

/** `POST /v1/trades/:code/review/skip` → 204 ("Skip review", owner 2026-11-01: shows nothing to anyone). */
export async function postSkip(code: string): Promise<void> {
  await api(`${tradePath(code)}/skip`, { method: 'POST', body: {} });
}

/** `GET /v1/reviews/pending`: the trades this trader must rate or skip first, oldest first. */
export async function fetchPendingReviews(signal?: AbortSignal): Promise<PendingReview[]> {
  const r = await api<{ trades?: unknown }>('/v1/reviews/pending', signal ? { signal } : {});
  const list = Array.isArray(r?.trades) ? r.trades : [];
  return list.filter(
    (t): t is PendingReview =>
      typeof t === 'object' && t !== null && typeof (t as PendingReview).code === 'string' && typeof (t as PendingReview).counterparty === 'string',
  );
}

export type Mood = 'great' | 'ok' | 'needs-work';

/**
 * `POST /v1/feedback { mood, note }` → 202 (P5-A19). The body has exactly these two keys: no
 * username, no trade code, nothing about the trade that came before.
 */
export async function postMood(mood: Mood, note: string): Promise<void> {
  await api('/v1/feedback', { method: 'POST', body: { mood, note } });
}

/**
 * The trader's completed trades now (`GET /v1/account/me`.completedTrades), read fresh, not from
 * the page's shared session answer, which was read before this trade completed. Null when unknown.
 */
export async function fetchCompletedTrades(): Promise<number | null> {
  const me = await api<{ completedTrades?: unknown }>('/v1/account/me');
  const n = me?.completedTrades;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** True for the refusals that mean "this trade has nothing left to rate" (done elsewhere, or not a rated trade). */
export function nothingToRate(e: unknown): boolean {
  return e instanceof ApiCallError && e.status === 409 && (e.code === 'review-exists' || e.code === 'not-reviewable');
}

/**
 * The side THIS trader rates on a trade (the other trader's role), from their own trade view
 * (`GET /v1/trades/:code`.role): it decides "Fast payment" or "Fast release" (P5-A7). Null when
 * the view has no usable role.
 */
export async function fetchRatedSide(code: string, signal?: AbortSignal): Promise<'buyer' | 'seller' | null> {
  const v = await api<{ role?: unknown }>(`/v1/trades/${encodeURIComponent(code)}`, signal ? { signal } : {});
  return v?.role === 'buyer' ? 'seller' : v?.role === 'seller' ? 'buyer' : null;
}

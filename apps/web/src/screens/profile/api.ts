// Plan 5 Tasks 5 and 12: the profile, badge settings and signed-record routes as the web calls them
// (apps/api/src/reputation/{profile,badgeRoutes,record}.ts). Answers are parsed strictly, so a
// renamed field fails loudly instead of showing wrong numbers.
import { api } from '../../api/client.js';

export type Visibility = 'featured' | 'hover' | 'hidden';

export interface PublicReview {
  neutral: boolean;
  stars: number | null;
  phrases: string[];
  tradeBadges: string[];
  note: string | null;
  method: string;
  /** Month and year only, "Mar 2026". */
  age: string;
  /** Plan 5 Task 19: disputed and not decided yet ("Under review"). */
  underReview: boolean;
  /** Task 19: on my own profile only, the review's id and whether I can still dispute it. */
  id?: string;
  disputable?: boolean;
}

export interface TraderProfile {
  tradeTag: string;
  self: boolean;
  /** "YYYY-MM". */
  memberSince: string;
  online: boolean;
  lastSeenAt: string | null;
  stats: {
    completedTrades: number;
    positivePct: number | null;
    ratedReviews: number;
    reviewCount: number;
    typicalMinutes: number | null;
    disputes: { won: number; lost: number };
  };
  badges: { featured: string[]; more: string[] };
  pgpProtected: boolean;
  recordPublic: boolean;
  tradedOverXmr: number | null;
  imported: { site: string; overUsd: number }[];
  reviews: PublicReview[];
  offers: number;
}

export interface BadgeSettings {
  earned: { id: string; level: Visibility }[];
  featured: string[];
  more: string[];
  nextMilestones: { label: string; have: number; need: number }[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const LEVELS: readonly string[] = ['featured', 'hover', 'hidden'];

function fail(what: string): never {
  throw new Error(`profile: bad ${what}`);
}

function parseReview(r: unknown): PublicReview {
  if (!isObj(r) || typeof r.neutral !== 'boolean' || !numOrNull(r.stars) || !strs(r.phrases) || !strs(r.tradeBadges)) fail('review');
  if (!(r.note === null || typeof r.note === 'string') || typeof r.method !== 'string' || typeof r.age !== 'string') fail('review');
  if (typeof r.underReview !== 'boolean') fail('review');
  if (!(r.id === undefined || typeof r.id === 'string') || !(r.disputable === undefined || typeof r.disputable === 'boolean')) fail('review');
  const out: PublicReview = { neutral: r.neutral, stars: r.stars, phrases: r.phrases, tradeBadges: r.tradeBadges, note: r.note, method: r.method, age: r.age, underReview: r.underReview };
  if (typeof r.id === 'string') out.id = r.id;
  if (typeof r.disputable === 'boolean') out.disputable = r.disputable;
  return out;
}

export function parseProfile(raw: unknown): TraderProfile {
  const p = raw;
  if (!isObj(p) || typeof p.tradeTag !== 'string' || typeof p.self !== 'boolean' || typeof p.memberSince !== 'string') fail('profile');
  if (typeof p.online !== 'boolean' || !(p.lastSeenAt === null || typeof p.lastSeenAt === 'string')) fail('presence');
  const s = p.stats;
  if (!isObj(s) || !isNum(s.completedTrades) || !numOrNull(s.positivePct) || !isNum(s.ratedReviews) || !isNum(s.reviewCount) || !numOrNull(s.typicalMinutes)) fail('stats');
  const d = s.disputes;
  if (!isObj(d) || !isNum(d.won) || !isNum(d.lost)) fail('disputes');
  const b = p.badges;
  if (!isObj(b) || !strs(b.featured) || !strs(b.more)) fail('badges');
  if (typeof p.pgpProtected !== 'boolean' || typeof p.recordPublic !== 'boolean' || !numOrNull(p.tradedOverXmr) || !isNum(p.offers)) fail('profile');
  if (!Array.isArray(p.imported) || !p.imported.every((l) => isObj(l) && typeof l.site === 'string' && isNum(l.overUsd))) fail('imported');
  if (!Array.isArray(p.reviews)) fail('reviews');
  return {
    tradeTag: p.tradeTag,
    self: p.self,
    memberSince: p.memberSince,
    online: p.online,
    lastSeenAt: p.lastSeenAt,
    stats: {
      completedTrades: s.completedTrades,
      positivePct: s.positivePct,
      ratedReviews: s.ratedReviews,
      reviewCount: s.reviewCount,
      typicalMinutes: s.typicalMinutes,
      disputes: { won: d.won, lost: d.lost },
    },
    badges: { featured: b.featured, more: b.more },
    pgpProtected: p.pgpProtected,
    recordPublic: p.recordPublic,
    tradedOverXmr: p.tradedOverXmr,
    imported: (p.imported as { site: string; overUsd: number }[]).map((l) => ({ site: l.site, overUsd: l.overUsd })),
    reviews: p.reviews.map(parseReview),
    offers: p.offers,
  };
}

export function parseBadgeSettings(raw: unknown): BadgeSettings {
  if (!isObj(raw) || !Array.isArray(raw.earned) || !strs(raw.featured) || !strs(raw.more) || !Array.isArray(raw.nextMilestones)) fail('badge settings');
  const earned = raw.earned.map((e) => {
    if (!isObj(e) || typeof e.id !== 'string' || typeof e.level !== 'string' || !LEVELS.includes(e.level)) fail('earned badge');
    return { id: e.id, level: e.level as Visibility };
  });
  const nextMilestones = raw.nextMilestones.map((m) => {
    if (!isObj(m) || typeof m.label !== 'string' || !isNum(m.have) || !isNum(m.need)) fail('milestone');
    return { label: m.label, have: m.have, need: m.need };
  });
  return { earned, featured: raw.featured, more: raw.more, nextMilestones };
}

const traderPath = (name: string) => `/v1/traders/${encodeURIComponent(name)}`;

export async function fetchProfile(name: string, signal?: AbortSignal): Promise<TraderProfile> {
  return parseProfile(await api<unknown>(traderPath(name), signal ? { signal } : {}));
}

export async function fetchBadgeSettings(signal?: AbortSignal): Promise<BadgeSettings> {
  return parseBadgeSettings(await api<unknown>('/v1/account/badges', signal ? { signal } : {}));
}

export async function chooseBadge(id: string, level: Visibility): Promise<BadgeSettings & { notice: string | null }> {
  const raw = await api<unknown>('/v1/account/badges', { method: 'PUT', body: { id, level } });
  const notice = isObj(raw) ? raw.notice : undefined;
  if (!(notice === null || typeof notice === 'string')) fail('notice');
  return { ...parseBadgeSettings(raw), notice };
}

function textOf(raw: unknown): string {
  if (!isObj(raw) || typeof raw.text !== 'string') fail('record');
  return raw.text;
}

/** My own signed record (once a minute); `withPgp` lists my PGP fingerprints too (P5-A35, off by default). */
export async function fetchMyRecord(withPgp: boolean): Promise<string> {
  return textOf(await api<unknown>(withPgp ? '/v1/account/record?pgp=1' : '/v1/account/record'));
}

export async function setRecordPublic(on: boolean): Promise<boolean> {
  const raw = await api<unknown>('/v1/account/record/public', { method: 'PUT', body: { on } });
  if (!isObj(raw) || typeof raw.on !== 'boolean') fail('record setting');
  return raw.on;
}

export async function fetchPublicRecord(name: string, signal?: AbortSignal): Promise<string> {
  return textOf(await api<unknown>(`${traderPath(name)}/record`, signal ? { signal } : {}));
}

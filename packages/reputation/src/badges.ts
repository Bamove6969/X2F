// Badge catalogue, earning rules and visibility (Plan 5 Task 2, spec 5.4).
// Badges are earned from facts on every read and never set; the only badge write is visibility.
// No badge or label says anything about money moved (spec 5.4: no volume badges).

export type Stage = 'starter' | 'building' | 'graduated';

const MILESTONES = [10, 50, 100, 500, 1000] as const;
const VETERAN_YEARS = [1, 3, 5] as const;

type MilestoneId = `trades-${(typeof MILESTONES)[number]}`;
type VeteranId = `veteran-${(typeof VETERAN_YEARS)[number]}`;
export type PastRepId = `past-rep:${string}`;
export type CatalogueId = 'new' | MilestoneId | VeteranId | 'trusted' | 'fast' | 'clean-record' | 'pgp' | 'security-key';
export type BadgeId = CatalogueId | PastRepId;

export interface BadgeInfo {
  label: string;
  meaning: string;
  /** lucide-react icon name (spec 5.4 icons; P5-A16 for the ones the spec does not name). */
  icon: string;
  tone: 'escrow' | 'caution';
}

/** Featured slots on an offer card (spec 5.4). New takes one of them (P5-A11). */
export const FEATURED_SLOTS = 2;

// P5-A13 thresholds.
export const TRUSTED_MIN_TRADES = 100;
export const TRUSTED_MIN_PCT = 98;
export const FAST_MAX_MINUTES = 10;
export const FAST_MIN_SAMPLES = 5;
export const CLEAN_RECORD_MIN_TRADES = 100;

function thousands(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const milestoneEntries = MILESTONES.map(
  (n) => [`trades-${n}`, { label: `${thousands(n)} trades`, meaning: `Completed ${thousands(n)} trades`, icon: 'Trophy', tone: 'escrow' }] as const,
);

/** Meanings are the BadgeSettings board's where it has one. */
export const BADGES: Record<CatalogueId, BadgeInfo> = {
  // COPY-UNSIGNED: New's meaning (no board line).
  new: { label: 'New', meaning: 'New to X2F, still on starter limits', icon: 'Sprout', tone: 'caution' },
  ...(Object.fromEntries(milestoneEntries) as Record<MilestoneId, BadgeInfo>),
  'veteran-1': { label: 'Veteran', meaning: 'Trading on X2F for 1+ year', icon: 'Star', tone: 'escrow' },
  // COPY-UNSIGNED: the 3- and 5-year labels and meanings (P5-A12).
  'veteran-3': { label: 'Veteran · 3 years', meaning: 'Trading on X2F for 3+ years', icon: 'Star', tone: 'escrow' },
  'veteran-5': { label: 'Veteran · 5 years', meaning: 'Trading on X2F for 5+ years', icon: 'Star', tone: 'escrow' },
  trusted: { label: 'Trusted', meaning: '100+ trades and 98%+ positive', icon: 'ShieldCheck', tone: 'escrow' },
  fast: { label: 'Fast', meaning: 'Usually pays or releases within 10 min', icon: 'Zap', tone: 'escrow' },
  // COPY-UNSIGNED: Clean record's meaning (spec 5.4 wording, no board line).
  'clean-record': { label: 'Clean record', meaning: '100 trades with no lost disputes', icon: 'BadgeCheck', tone: 'escrow' },
  pgp: { label: 'PGP verified', meaning: 'Signs in with a verified PGP key', icon: 'KeyRound', tone: 'escrow' },
  'security-key': { label: 'Security key verified', meaning: 'Protects the account with a hardware key', icon: 'Usb', tone: 'escrow' },
};

export const PAST_REP_ICON = 'History';

export interface BadgeFacts {
  /** Plan 3 `tradeCap(...).stage`: New shows while it is not `graduated` (spec 2.3). */
  stage: Stage;
  /** Released trades plus settled disputes whoever won (R38; Task 20 running totals). */
  completedTrades: number;
  /** From revealed reviews only, leaving out disputed ("Under review") and removed ones. */
  positivePct: number | null;
  typicalMinutes: number | null;
  typicalSamples: number;
  /** Every lost dispute ever (Task 20 running total). */
  lostDisputes: number;
  accountCreatedAt: Date;
  hasPgp: boolean;
  hasSecurityKey: boolean;
  /** Approved past-reputation claims. Never feeds any other badge (spec 5.5). */
  pastRep: { id: string; site: string; trades: number }[];
}

function fullYearsSince(from: Date, now: Date): number {
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  const anniversary = new Date(from);
  anniversary.setUTCFullYear(from.getUTCFullYear() + years);
  if (anniversary.getTime() > now.getTime()) years--;
  return years;
}

function highest<T extends number>(steps: readonly T[], value: number): T | null {
  let best: T | null = null;
  for (const s of steps) if (value >= s) best = s;
  return best;
}

/** Every badge the facts earn, in catalogue order (past reputation last). */
export function earnedBadges(f: BadgeFacts, now: Date): BadgeId[] {
  const out: BadgeId[] = [];
  if (f.stage !== 'graduated') out.push('new');
  const m = highest(MILESTONES, f.completedTrades);
  if (m !== null) out.push(`trades-${m}`);
  const v = highest(VETERAN_YEARS, fullYearsSince(f.accountCreatedAt, now));
  if (v !== null) out.push(`veteran-${v}`);
  if (f.completedTrades >= TRUSTED_MIN_TRADES && f.positivePct !== null && f.positivePct >= TRUSTED_MIN_PCT) out.push('trusted');
  if (f.typicalMinutes !== null && f.typicalMinutes <= FAST_MAX_MINUTES && f.typicalSamples >= FAST_MIN_SAMPLES) out.push('fast');
  if (f.completedTrades >= CLEAN_RECORD_MIN_TRADES && f.lostDisputes === 0) out.push('clean-record');
  if (f.hasPgp) out.push('pgp');
  if (f.hasSecurityKey) out.push('security-key');
  for (const p of f.pastRep) out.push(`past-rep:${p.id}`);
  return out;
}

// ---- Visibility ----

export type Visibility = 'featured' | 'hover' | 'hidden';

export interface BadgePrefs {
  /** False until the trader saves a first choice; the spec 5.4 defaults apply until then. */
  chosen: boolean;
  levels: Partial<Record<BadgeId, Visibility>>;
  /** Featured badges, oldest first (the oldest is bumped by a third). */
  order: BadgeId[];
}

export type BadgeErrorCode = 'new-is-fixed' | 'not-earned';

export class BadgeError extends Error {
  constructor(readonly code: BadgeErrorCode) {
    super(code);
    this.name = 'BadgeError';
  }
}

function isMilestone(id: BadgeId): boolean {
  return id.startsWith('trades-');
}
function isVeteran(id: BadgeId): boolean {
  return id.startsWith('veteran-');
}

/** Spec 5.4 defaults: Trusted, then the highest trade milestone, then Fast, then Veteran. */
function defaultFeatured(earned: readonly BadgeId[], slots: number): BadgeId[] {
  const picks: (BadgeId | undefined)[] = [
    earned.find((b) => b === 'trusted'),
    earned.find(isMilestone),
    earned.find((b) => b === 'fast'),
    earned.find(isVeteran),
  ];
  return picks.filter((b): b is BadgeId => b !== undefined).slice(0, slots);
}

/** The level a badge has once the trader has chosen: saved, else On hover (P5-A15). */
function levelOf(prefs: BadgePrefs, id: BadgeId): Visibility {
  return prefs.levels[id] ?? 'hover';
}

/**
 * Splits earned badges into Featured (offer cards, at most 2) and More (the "+N" list).
 * New is always first in Featured and can't be hidden; Hidden badges are in neither list.
 */
export function resolveVisibility(earned: readonly BadgeId[], prefs: BadgePrefs): { featured: BadgeId[]; more: BadgeId[] } {
  const hasNew = earned.includes('new');
  const rest: BadgeId[] = earned.filter((b) => b !== 'new');
  const slots = FEATURED_SLOTS - (hasNew ? 1 : 0);
  let chosen: BadgeId[];
  if (!prefs.chosen) {
    chosen = defaultFeatured(rest, slots);
  } else {
    // The saved order is the single source of Featured (review M2): a `featured` level outside it is
    // never promoted (P5-A15: nothing is promoted automatically).
    const wanted = (b: BadgeId) => rest.includes(b) && levelOf(prefs, b) === 'featured';
    chosen = prefs.order.filter((b, i) => wanted(b) && prefs.order.indexOf(b) === i).slice(0, slots);
  }
  const featured: BadgeId[] = hasNew ? ['new', ...chosen] : chosen;
  const more = rest.filter((b) => !chosen.includes(b) && (!prefs.chosen || levelOf(prefs, b) !== 'hidden'));
  return { featured, more };
}

function labelOf(id: BadgeId): string {
  return id.startsWith('past-rep:') ? 'Past reputation' : BADGES[id as CatalogueId].label;
}

/**
 * Sets one badge's level. Featuring one more than the slots allow moves the oldest featured badge to
 * On hover, with the board's notice. The first choice saves the defaults as levels, so nothing else
 * moves. Returns new prefs; the given ones are not changed.
 */
export function applyChoice(
  earned: readonly BadgeId[],
  prefs: BadgePrefs,
  id: BadgeId,
  level: Visibility,
): { prefs: BadgePrefs; notice: string | null } {
  if (id === 'new') throw new BadgeError('new-is-fixed');
  if (!earned.includes(id)) throw new BadgeError('not-earned');

  const current = resolveVisibility(earned, prefs);
  const featuredNow = current.featured.filter((b) => b !== 'new');
  const levels: Partial<Record<BadgeId, Visibility>> = { ...prefs.levels };
  if (!prefs.chosen) {
    for (const b of earned) if (b !== 'new') levels[b] = featuredNow.includes(b) ? 'featured' : 'hover';
  }
  let order: BadgeId[] = featuredNow.filter((b) => b !== id);
  let notice: string | null = null;

  if (level === 'featured' && !featuredNow.includes(id)) {
    const slots = FEATURED_SLOTS - (earned.includes('new') ? 1 : 0);
    if (order.length >= slots) {
      const bumped = order[0]!;
      order = order.slice(1);
      levels[bumped] = 'hover';
      notice = `${labelOf(bumped)} moved to On hover. Only ${FEATURED_SLOTS} badges can be featured.`;
    }
    order.push(id);
  } else if (level === 'featured') {
    order = featuredNow;
  }
  levels[id] = level;
  // A `featured` level outside the new order (a badge lost and later re-earned, or a bad row) goes back
  // to On hover, so the saved level always matches what is shown (review M2).
  for (const b of Object.keys(levels) as BadgeId[]) {
    if (levels[b] === 'featured' && !order.includes(b)) levels[b] = 'hover';
  }
  return { prefs: { chosen: true, levels, order }, notice };
}

/**
 * The level a trader sees for one earned badge, consistent with `resolveVisibility` (Task 5's
 * `earned[].level`). `null` when the badge is not earned.
 */
export function levelShown(earned: readonly BadgeId[], prefs: BadgePrefs, id: BadgeId): Visibility | null {
  if (!earned.includes(id)) return null;
  const r = resolveVisibility(earned, prefs);
  if (r.featured.includes(id)) return 'featured';
  return r.more.includes(id) ? 'hover' : 'hidden';
}

/** Progress lines for Profile, Badges (board: "500 trades 212 / 500", "Clean record 88 / 100"). */
export function nextMilestones(f: Pick<BadgeFacts, 'completedTrades' | 'lostDisputes'>): { label: string; have: number; need: number }[] {
  const out: { label: string; have: number; need: number }[] = [];
  const next = MILESTONES.find((n) => n > f.completedTrades);
  if (next !== undefined) out.push({ label: `${thousands(next)} trades`, have: f.completedTrades, need: next });
  if (f.lostDisputes === 0 && f.completedTrades < CLEAN_RECORD_MIN_TRADES) {
    out.push({ label: BADGES['clean-record'].label, have: f.completedTrades, need: CLEAN_RECORD_MIN_TRADES });
  }
  return out;
}

/** Spec 5.5: "Verified: 1,240 trades on LocalMonero (PGP proof)". */
export function pastRepLabel(site: string, trades: number): string {
  return `Verified: ${thousands(trades)} trades on ${site} (PGP proof)`;
}

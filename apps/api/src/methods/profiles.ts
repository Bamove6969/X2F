import { readFileSync } from 'node:fs';
import { MAX_CONFIRM_WINDOW_MIN } from '@x2f/trade';

/** One payment method in `data/payment-methods.json` (spec 2.6). */
export interface CatalogMethod {
  id: string;
  name: string;
  group: string;
  /** In "Gift cards & vouchers" (owner, 2026-10-21): an offer must name the card's country and currency (Task 4). */
  giftCard: boolean;
  /** Set when a lawyer must sign off first (e.g. sanctions); such a method is unavailable (P3-I20). */
  legalReview: string | null;
  verified: boolean;
}

export type FieldKind = 'email-or-phone' | 'iban' | 'account' | 'postal' | 'text';

/** The profile that drives all copy about a method (spec 2.6). */
export interface MethodProfile {
  id: string;
  /** One plain sentence. */
  whatItIs: string;
  /** Where the money lands and where to check; fills every "check your…" prompt, so it never names the method. */
  landsIn: string;
  checkPrompt: string;
  arrival: 'instant' | 'same-day' | 'days';
  /**
   * The seller's confirmation window, which is also either side's wait from "I've paid" before a
   * dispute (machine.ts `confirmBy`, owner p9-4). Owner F9 (7 Nov) with the F1 research table it approved:
   * instant types 90 min; same or next day 24 h; slow types 48 h to 4 days.
   */
  confirmWindowMin: number;
  fields: { key: string; label: string; kind: FieldKind }[];
}

/**
 * The profiles (spec 11.5's launch set: Zelle, Cash App, Revolut, Wise, ACH, SEPA, Cash by mail,
 * Custom method; then owner 2026-11-07 F9, "give the common payment types their own profile",
 * research F1's table: Interac, SEPA Instant, PayPal, Venmo, PIX, UPI, Faster Payments, domestic
 * wire, SWIFT and one for every gift card).
 */
export const LAUNCH_PROFILE_IDS = [
  'ZELLE', 'CASH_APP', 'REVOLUT', 'TRANSFERWISE', 'ACH_TRANSFER', 'SEPA', 'PAY_BY_MAIL', 'CUSTOM',
  'INTERAC_E_TRANSFER', 'SEPA_INSTANT', 'PAYPAL', 'VENMO', 'PIX', 'UPI', 'FASTER_PAYMENTS', 'DOMESTIC_WIRE_TRANSFER', 'SWIFT', 'OTHER_GIFT_CARD',
] as const;

/** The profile a method with none of its own uses at take: the Custom method's (24 h). */
export const FALLBACK_PROFILE_ID = 'CUSTOM';
/** The profile every gift card without one of its own uses (owner 2026-11-07 F9: instant, 90 min). */
export const GIFT_CARD_PROFILE_ID = 'OTHER_GIFT_CARD';

export const GIFT_CARD_GROUP = 'Gift cards & vouchers';

/** The shortest confirm window: the instant types' 90 minutes (owner F9, 7 Nov; was 120). */
export const MIN_CONFIRM_WINDOW_MIN = 90;

const DATA = new URL('../../../../data/', import.meta.url);
const ARRIVALS = ['instant', 'same-day', 'days'] as const;
const KINDS: readonly FieldKind[] = ['email-or-phone', 'iban', 'account', 'postal', 'text'];

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function bad(file: string, why: string): Error {
  return new Error(`data/${file}: ${why}`);
}

/** Reads and checks the catalog; throws at startup on a malformed entry rather than serving it. */
export function loadCatalog(raw: unknown): CatalogMethod[] {
  const file = 'payment-methods.json';
  if (!isRecord(raw) || !Array.isArray(raw.methods)) throw bad(file, 'no methods list');
  const seen = new Set<string>();
  return raw.methods.map((m: unknown) => {
    if (!isRecord(m) || !nonEmpty(m.id) || !/^[A-Z0-9_]+$/.test(m.id) || !nonEmpty(m.name) || !nonEmpty(m.group)) {
      throw bad(file, 'an entry needs an upper-case id, a name and a group');
    }
    if (seen.has(m.id)) throw bad(file, `duplicate id ${m.id}`);
    seen.add(m.id);
    const giftCard = m.giftCard === true;
    if (m.giftCard !== undefined && typeof m.giftCard !== 'boolean') throw bad(file, `${m.id}: giftCard must be a boolean`);
    if (giftCard !== (m.group === GIFT_CARD_GROUP)) throw bad(file, `${m.id}: giftCard must be set exactly on "${GIFT_CARD_GROUP}"`);
    if (m.legalReview !== undefined && !nonEmpty(m.legalReview)) throw bad(file, `${m.id}: legalReview must be text`);
    return {
      id: m.id, name: m.name, group: m.group, giftCard,
      legalReview: typeof m.legalReview === 'string' ? m.legalReview : null, verified: m.verified === true,
    };
  });
}

/** Reads and checks the profiles against the catalog. */
export function loadProfiles(raw: unknown, methods: readonly CatalogMethod[]): MethodProfile[] {
  const file = 'payment-method-profiles.json';
  if (!isRecord(raw) || !Array.isArray(raw.profiles)) throw bad(file, 'no profiles list');
  const seen = new Set<string>();
  return raw.profiles.map((p: unknown) => {
    if (!isRecord(p) || !nonEmpty(p.id)) throw bad(file, 'a profile needs an id');
    const method = methods.find((m) => m.id === p.id);
    if (!method) throw bad(file, `${p.id} is not in the catalog`);
    if (seen.has(p.id)) throw bad(file, `duplicate profile ${p.id}`);
    seen.add(p.id);
    const { whatItIs, landsIn, checkPrompt, arrival, confirmWindowMin, fields } = p;
    if (!nonEmpty(whatItIs) || !nonEmpty(landsIn) || !nonEmpty(checkPrompt)) throw bad(file, `${p.id}: missing text`);
    if (landsIn.toLowerCase().includes(method.name.toLowerCase())) throw bad(file, `${p.id}: landsIn must not name the method`);
    const arr = ARRIVALS.find((a) => a === arrival);
    if (!arr) throw bad(file, `${p.id}: arrival`);
    if (
      typeof confirmWindowMin !== 'number' ||
      !Number.isInteger(confirmWindowMin) ||
      confirmWindowMin < MIN_CONFIRM_WINDOW_MIN ||
      confirmWindowMin > MAX_CONFIRM_WINDOW_MIN
    ) {
      throw bad(file, `${p.id}: confirmWindowMin must be ${MIN_CONFIRM_WINDOW_MIN}-${MAX_CONFIRM_WINDOW_MIN}`);
    }
    if (!Array.isArray(fields) || fields.length === 0) throw bad(file, `${p.id}: fields`);
    const outFields = fields.map((f: unknown) => {
      if (!isRecord(f) || !nonEmpty(f.key) || !nonEmpty(f.label) || !KINDS.includes(f.kind as FieldKind)) throw bad(file, `${p.id}: a field`);
      return { key: f.key, label: f.label, kind: f.kind as FieldKind };
    });
    return { id: p.id, whatItIs, landsIn, checkPrompt, arrival: arr, confirmWindowMin, fields: outFields };
  });
}

const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, DATA), 'utf8')) as unknown;

const CATALOG: readonly CatalogMethod[] = Object.freeze(loadCatalog(readJson('payment-methods.json')));
const BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

/** The launch method profiles, read once at startup. */
export const PROFILES: readonly MethodProfile[] = Object.freeze(loadProfiles(readJson('payment-method-profiles.json'), CATALOG));
const PROFILE_BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

/** Every catalog entry, in file order, including unavailable ones. */
export function catalog(): readonly CatalogMethod[] {
  return CATALOG;
}

export function getMethod(id: string): CatalogMethod | null {
  return BY_ID.get(id) ?? null;
}

export function getProfile(id: string): MethodProfile | null {
  return PROFILE_BY_ID.get(id) ?? null;
}

/**
 * The profile a trade on `methodId` is taken with (its confirm window, which is also either
 * side's wait before a dispute): the method's own, else the gift card one for any gift card, else the Custom method's.
 */
export function tradeProfile(methodId: string): MethodProfile {
  const p = getProfile(methodId) ?? (isGiftCard(methodId) ? getProfile(GIFT_CARD_PROFILE_ID) : null) ?? getProfile(FALLBACK_PROFILE_ID);
  if (p === null) throw new Error('no fallback method profile');
  return p;
}

/** In the catalog and not waiting for legal review (P3-I20): only these may be listed or offered. */
export function isAvailable(id: string): boolean {
  const m = BY_ID.get(id);
  return m !== undefined && m.legalReview === null;
}

export function isGiftCard(id: string): boolean {
  return BY_ID.get(id)?.giftCard === true;
}

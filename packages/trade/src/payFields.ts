/**
 * The payee's payment details per payment method (J-08, row S-090; owner p7-3: "those boxes can
 * appear in the chat window on the person's side who is sending that payment type ... they just
 * have to click send, and it sends it all nicely packaged over to the other person").
 *
 * This module is the data and the pure rules, shared by the trader app's chat (which seals the
 * package inside the end-to-end encrypted envelope, apps/web chatCrypto) and anything that later
 * opens one. The API never sees these values: they only ever travel as ciphertext.
 *
 * SOURCE of the table: research/research-pack-2026-11-09.md (on the research branch, worktree
 * `research`), Part 2 "Required payee fields per payment method" (13 rows, with the pack's
 * confidence marks: READ, SNIPPET, UNVERIFIED), copied row by row on 2026-11-09. Where that table says "A or B" the fields share a `oneOf` group: at least one of the
 * group must be filled. Where it lists a field under "Optional fields" or does not list a name at
 * all, the field is optional (`need: 'no'`). ACH is not in the pack: its row is
 * data/payment-method-profiles.json's ACH_TRANSFER fields. Every other catalog method (CUSTOM
 * included) gets PAY_FIELDS_FALLBACK: one free-text box, as CUSTOM's profile has.
 *
 * Open owner questions on what is required vs optional are listed in the J-08 report, not decided
 * here: this table follows the pack's answer.
 */

export type PayFieldKind = 'text' | 'email' | 'phone' | 'iban' | 'account' | 'postal';

/**
 * Whether a box must be filled: 'yes'; 'no'; or `{ oneOf }`, when at least one box of that group
 * must be (Interac: email or phone, "you just have to have one or the other", owner p7-3).
 */
export type PayFieldNeed = 'yes' | 'no' | { oneOf: string };

export interface PayFieldSpec {
  /** Stable key inside the sealed message (never shown). */
  key: string;
  /** The box's label, on both sides. COPY-UNSIGNED. */
  label: string;
  kind: PayFieldKind;
  need: PayFieldNeed;
}

export interface PayFieldsSpec {
  fields: readonly PayFieldSpec[];
  /** The research pack row (and its confidence mark) this row was copied from. */
  source: string;
}

/** The version inside the sealed `pay` payload. */
export const PAY_DETAILS_V = 1;

/** The most characters one box takes: a one-line box, and the mailing address. */
export const PAY_FIELD_MAX_CHARS = { line: 120, postal: 400 } as const;
/** The most lines a mailing address takes. */
export const PAY_POSTAL_MAX_LINES = 8;

const yes = (key: string, label: string, kind: PayFieldKind = 'text'): PayFieldSpec => ({ key, label, kind, need: 'yes' });
const no = (key: string, label: string, kind: PayFieldKind = 'text'): PayFieldSpec => ({ key, label, kind, need: 'no' });
const one = (group: string, key: string, label: string, kind: PayFieldKind = 'text'): PayFieldSpec => ({ key, label, kind, need: { oneOf: group } });

// Labels: COPY-UNSIGNED (J-08; the owner signs the wording pages, J-26).
const NAME = 'Name on the account';
const FULL_NAME = 'Full name';
const EMAIL = 'Email';
const PHONE = 'Phone number';

const PACK = 'research/research-pack-2026-11-09.md Part 2';

/** The table, by catalog id (data/payment-methods.json). */
export const PAY_FIELDS: Readonly<Record<string, PayFieldsSpec>> = Object.freeze({
  // Row 1: "Recipient's email address or U.S. mobile number." A name is not listed, so it is optional.
  ZELLE: { fields: [one('contact', 'email', EMAIL, 'email'), one('contact', 'phone', 'US phone number', 'phone'), no('name', NAME)], source: `${PACK} row 1 Zelle (READ)` },
  // Row 2: "add recipient with name plus email and/or mobile" (and the owner's own example, p7-3).
  INTERAC_E_TRANSFER: { fields: [yes('name', FULL_NAME), one('contact', 'email', EMAIL, 'email'), one('contact', 'phone', PHONE, 'phone')], source: `${PACK} row 2 Interac e-Transfer (READ)` },
  // Rows 3 and 4: "Beneficiary IBAN and name"; BIC "no longer needed ... in practice".
  SEPA: { fields: [yes('name', NAME), yes('iban', 'IBAN', 'iban'), no('bic', 'BIC', 'account')], source: `${PACK} row 3 SEPA (SNIPPET)` },
  SEPA_INSTANT: { fields: [yes('name', NAME), yes('iban', 'IBAN', 'iban'), no('bic', 'BIC', 'account')], source: `${PACK} row 4 SEPA Instant (SNIPPET)` },
  // Row 5: "Depends on currency: IBAN ...; sort code plus account number for GBP; account holder name".
  // A Wise account is also reached by its email (the profiles file). One of the three ways.
  TRANSFERWISE: {
    fields: [yes('name', NAME), one('reach', 'email', 'Email registered with the account', 'email'), one('reach', 'iban', 'IBAN', 'iban'), one('reach', 'ukAccount', 'Sort code and account number (GBP)', 'account')],
    source: `${PACK} row 5 Wise (SNIPPET)`,
  },
  // Row 6: "search by Revtag, phone number or email".
  REVOLUT: { fields: [one('reach', 'revtag', 'Revtag', 'account'), one('reach', 'phone', PHONE, 'phone'), one('reach', 'email', EMAIL, 'email'), no('name', NAME)], source: `${PACK} row 6 Revolut (SNIPPET)` },
  // Row 7: "$cashtag, phone number or email".
  CASH_APP: { fields: [one('reach', 'cashtag', '$cashtag', 'account'), one('reach', 'phone', PHONE, 'phone'), one('reach', 'email', EMAIL, 'email')], source: `${PACK} row 7 Cash App (READ)` },
  // Row 8: "Recipient's name, PayPal username, email or mobile number, or a PayPal.Me link".
  PAYPAL: {
    fields: [one('reach', 'email', EMAIL, 'email'), one('reach', 'phone', PHONE, 'phone'), one('reach', 'username', 'PayPal username', 'account'), one('reach', 'link', 'PayPal.Me link', 'account'), no('name', NAME)],
    source: `${PACK} row 8 PayPal (READ)`,
  },
  // Row 9: "Recipient's name, Venmo username, phone number or email".
  VENMO: { fields: [one('reach', 'username', 'Venmo username', 'account'), one('reach', 'phone', PHONE, 'phone'), one('reach', 'email', EMAIL, 'email'), no('name', NAME)], source: `${PACK} row 9 Venmo (READ)` },
  // Row 10: "Sort code and account number plus payee name".
  FASTER_PAYMENTS: { fields: [yes('name', NAME), yes('sortCode', 'Sort code', 'account'), yes('account', 'Account number', 'account')], source: `${PACK} row 10 UK Faster Payments (SNIPPET)` },
  // Row 11: "A Pix key (mobile number in E.164, email, CPF/CNPJ, or a random key)".
  PIX: { fields: [yes('pixKey', 'Pix key (phone, email, CPF/CNPJ or random key)', 'account'), no('name', NAME)], source: `${PACK} row 11 PIX (SNIPPET)` },
  // Row 12: "UPI ID (VPA), mobile number registered with UPI, ... or account number plus IFSC".
  UPI: { fields: [one('reach', 'upiId', 'UPI ID', 'account'), one('reach', 'phone', 'Mobile number registered with UPI', 'phone'), one('reach', 'accountIfsc', 'Account number and IFSC', 'account'), no('name', NAME)], source: `${PACK} row 12 UPI (SNIPPET)` },
  // Row 13: "Mailing address and recipient name; no bank fields".
  PAY_BY_MAIL: { fields: [yes('name', FULL_NAME), yes('address', 'Mailing address', 'postal')], source: `${PACK} row 13 Cash by mail (SNIPPET)` },
  // Not in the pack: the launch profile's fields (data/payment-method-profiles.json, ACH_TRANSFER).
  ACH_TRANSFER: { fields: [yes('name', NAME), yes('routing', 'Routing number', 'account'), yes('account', 'Account number', 'account')], source: 'data/payment-method-profiles.json ACH_TRANSFER (not researched)' },
});

/** Any method outside the table: one free-text box (CUSTOM's profile has the same). */
export const PAY_FIELDS_FALLBACK: readonly PayFieldSpec[] = Object.freeze([yes('details', 'Payment details')]);

/** The boxes for a method: its table row, or the one free-text box. */
export function payFieldsFor(methodId: string): readonly PayFieldSpec[] {
  return Object.prototype.hasOwnProperty.call(PAY_FIELDS, methodId) ? PAY_FIELDS[methodId]!.fields : PAY_FIELDS_FALLBACK;
}

export type PayDetailsErrorCode = 'missing' | 'one-of' | 'unknown-field' | 'bad-value' | 'bad-chars' | 'too-long' | 'bad-shape';

/**
 * What a one-line account box (kinds email, phone, iban, account) may hold (pay-details review M6):
 * letters with their combining marks (Indic, Thai, Arabic and decomposed Latin text need them),
 * digits, punctuation, symbols and the plain space. Nothing else: no tab or other whitespace, no
 * format character (the joiners ZWNJ/ZWJ, the direction marks LRM/RLM/ALM, the soft hyphen, word
 * joiner and BOM), no line or paragraph separator, no control, and no variation selector or
 * Mongolian free variation selector (marks that render as nothing). The chat's own text check
 * refuses most hidden characters already; this closes what it allows for a line of text (tab,
 * ZWNJ/ZWJ, LRM/RLM/ALM) and the separators and spaces (Zl, Zp, Zs) it never looks at. A hidden
 * character here only ever hurts the payee: the value copied at the payer's bank would not match.
 * Written as escapes: no literal invisible characters in source.
 */
const ACCOUNT_CHARS = /^(?:(?![\ufe00-\ufe0f\u180b-\u180f\u{e0100}-\u{e01ef}])[\p{L}\p{M}\p{N}\p{P}\p{S} ])*$/u;

/** A refused package. `key` names the box (or the one-of group); messages never carry a value. */
export class PayDetailsError extends Error {
  readonly code: PayDetailsErrorCode;
  readonly key: string | null;
  constructor(code: PayDetailsErrorCode, key: string | null = null) {
    super(key === null ? code : `${code}: ${key}`);
    this.name = 'PayDetailsError';
    this.code = code;
    this.key = key;
  }
}

/** One filled box, as sealed. */
export interface PayDetailField {
  key: string;
  value: string;
}

/** The `pay` payload inside a chat envelope (next to the plain `text` every reader shows). */
export interface PayDetailsPayload {
  v: typeof PAY_DETAILS_V;
  method: string;
  fields: PayDetailField[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Checks the boxes as typed: every table key, each value a string; trimmed; required boxes filled,
 * each one-of group with at least one; one-line boxes without a line break, an account box
 * (email, phone, iban, account) with only ACCOUNT_CHARS, a mailing address with at most
 * PAY_POSTAL_MAX_LINES; within PAY_FIELD_MAX_CHARS. Returns the filled boxes in table order
 * (empty optional ones dropped). Throws PayDetailsError.
 */
export function checkPayDetails(methodId: string, values: Record<string, unknown>): PayDetailField[] {
  const spec = payFieldsFor(methodId);
  for (const k of Object.keys(values)) if (!spec.some((f) => f.key === k)) throw new PayDetailsError('unknown-field', k);
  const out: PayDetailField[] = [];
  const groups = new Map<string, boolean>();
  for (const f of spec) {
    const raw = values[f.key];
    if (raw !== undefined && typeof raw !== 'string') throw new PayDetailsError('bad-value', f.key);
    const value = (raw ?? '').trim();
    const filled = value !== '';
    if (typeof f.need === 'object') groups.set(f.need.oneOf, (groups.get(f.need.oneOf) ?? false) || filled);
    if (!filled) {
      if (f.need === 'yes') throw new PayDetailsError('missing', f.key);
      continue;
    }
    if (f.kind === 'postal') {
      if (value.includes('\r') || value.split('\n').length > PAY_POSTAL_MAX_LINES) throw new PayDetailsError('bad-value', f.key);
      if (value.length > PAY_FIELD_MAX_CHARS.postal) throw new PayDetailsError('too-long', f.key);
    } else {
      if (/[\r\n]/.test(value)) throw new PayDetailsError('bad-value', f.key);
      if (f.kind !== 'text' && !ACCOUNT_CHARS.test(value)) throw new PayDetailsError('bad-chars', f.key);
      if (value.length > PAY_FIELD_MAX_CHARS.line) throw new PayDetailsError('too-long', f.key);
    }
    out.push({ key: f.key, value });
  }
  for (const [group, any] of groups) if (!any) throw new PayDetailsError('one-of', group);
  return out;
}

/**
 * The sealed `pay` payload, checked: exactly `{ v, method, fields }`, fields exactly `{ key, value }`
 * each, in table order with no repeats, and the same boxes checkPayDetails would return for them
 * (trimmed, required ones present, groups met). Throws PayDetailsError('bad-shape') for the shape,
 * checkPayDetails' codes for the boxes.
 */
export function parsePayDetails(raw: unknown): PayDetailsPayload {
  const shape = (): PayDetailsError => new PayDetailsError('bad-shape');
  if (!isRecord(raw)) throw shape();
  const keys = Object.keys(raw).sort();
  if (keys.length !== 3 || keys[0] !== 'fields' || keys[1] !== 'method' || keys[2] !== 'v') throw shape();
  if (raw.v !== PAY_DETAILS_V || typeof raw.method !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(raw.method) || !Array.isArray(raw.fields) || raw.fields.length === 0) throw shape();
  const values: Record<string, string> = {};
  const fields: PayDetailField[] = raw.fields.map((f: unknown) => {
    if (!isRecord(f) || Object.keys(f).length !== 2 || typeof f.key !== 'string' || typeof f.value !== 'string') throw shape();
    if (Object.prototype.hasOwnProperty.call(values, f.key)) throw shape();
    values[f.key] = f.value;
    return { key: f.key, value: f.value };
  });
  const checked = checkPayDetails(raw.method, values);
  // The same boxes, in the same order, exactly as typed (no trimming left to do): one canonical form.
  if (checked.length !== fields.length || checked.some((c, i) => c.key !== fields[i]!.key || c.value !== fields[i]!.value)) throw shape();
  return { v: PAY_DETAILS_V, method: raw.method, fields };
}

/** The plain-text title of the package (the first line of the fallback text, and the card's heading). COPY-UNSIGNED */
export const PAY_DETAILS_TITLE = 'Payment details';

/**
 * The plain text every chat reader shows for a package, old ones included: the title, then one
 * "Label: value" line per filled box, in table order. Deterministic, so a reader can check the
 * text it was sent against the fields it was sent (the two can never disagree).
 */
export function renderPayDetailsText(pay: PayDetailsPayload): string {
  const spec = payFieldsFor(pay.method);
  const lines = pay.fields.map((f) => {
    const label = spec.find((s) => s.key === f.key)?.label;
    if (label === undefined) throw new PayDetailsError('unknown-field', f.key);
    return `${label}: ${f.value}`;
  });
  return [PAY_DETAILS_TITLE, ...lines].join('\n');
}

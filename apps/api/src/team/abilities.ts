/**
 * Team members' abilities: the granular permission catalogue (Job 1c, J-10; Plan 2 Task 18, Plan 3
 * Task 42; spec 6.7, R44; owner S-087, S-092, S-094, S-097, T-076, D-066, C-019).
 *
 * One list of boxes is the only truth (owner-checklists-draft-2026-11-09.md section B, "Types or
 * granular?" option 3, the lead's recommendation): each member holds a SET of ability ids
 * (`team_members.abilities`, migration 360). Presets (Offers, Trades, Manager, and the 10-box start
 * set) are one-click starting points that tick a set; the lead can then tick or untick any box,
 * and a set that matches no preset is "Custom". The owner ticks the list on his page 13; his ticks
 * change the DATA here (an ability's `offers` / `trades` / `start` defaults, a preset, a label),
 * never the checks.
 *
 * Hard rules (the owner's; no box, no preset and no stored set can grant them): `HARD_OWNER_ONLY`.
 * - Members never confirm payment received on the lead's sell trades (p10-2, T-076). Releasing was
 *   one of these rules; since the owner question trades-release (26 Nov 2026, pending his final
 *   yes) it is the Release coins box (22), which needs Hold trade keys (67) too (`ABILITY_REQUIRES`).
 * - Members never touch payout wallets, the team's members, account deletion or security settings.
 * - Only trade parties open disputes (D-066, p7-7); the "disputes" box sees the dispute and answers
 *   the moderator.
 * - Notes on traders: "view" and "add" boxes, every added note logged; there is no delete box (S-094).
 * The database refuses a stored set holding one (migration 360's check), `parseAbilities` refuses
 * one, and `hasAbility` never answers yes for one even if a row were corrupted.
 *
 * Labels and descriptions are the checklist draft's words, for the web to render from
 * `GET /v1/team/permissions`. COPY-UNSIGNED: the owner and design sign the wording on page 13.
 */
import { ApiError } from '../errors.js';

export type AbilityGroupId = 'offers' | 'trades' | 'chat' | 'proof' | 'disputes' | 'wallets' | 'team' | 'security' | 'account';
export type Risk = 'low' | 'medium' | 'high';

/**
 * What the box does today:
 * - `grantable`: a box; member routes check it now.
 * - `not-built`: a box the lead can tick and the API stores; no member route uses it yet (the
 *   feature, or the member's way into it, is not built). Ticking it changes nothing until then.
 * - `waits-member-keys`: a box; the API still refuses it to members (`member-cannot-sign`) until
 *   Plan 3 Task 42's member signing (the escrow-key sync of migration 860 gives an assigned member a copy to read, not to sign; owner question trades-release).
 * - `waits-member-chat-key`: a box; chat and proof stay hidden from members until a team-member
 *   chat key path exists (C-019, lead default): every chat route stays owner-only.
 * - `always`: every member has it; not a box.
 * - `owner-only`: the account owner's alone; never a box (`hard`: an owner ruling, see above;
 *   otherwise a lead or design default the owner may lift on page 13).
 */
export type Availability = 'grantable' | 'not-built' | 'waits-member-keys' | 'waits-member-chat-key' | 'always' | 'owner-only';

export interface Ability {
  /** The row number in section B (1..66; 67 added 26 Nov), for the owner's page. */
  no: number;
  /** Stable id: stored in `team_members.abilities`, named by routes. Never renamed. */
  id: string;
  group: AbilityGroupId;
  /** COPY-UNSIGNED */
  label: string;
  /** COPY-UNSIGNED: what it lets the member do. */
  does: string;
  risk: Risk;
  availability: Availability;
  /** For `owner-only`: an owner ruling (true) or a lead/design default (false). */
  hard: boolean;
  /** The earlier ruling that fixes the box, as the checklist cites it, or null. */
  ruling: string | null;
  /** Start state in the Offers and Trades bundles (owner 29 Oct) and the 10-box start set (p7-12). */
  offers: boolean;
  trades: boolean;
  start: boolean;
}

export interface AbilityGroup {
  id: AbilityGroupId;
  /** COPY-UNSIGNED */
  label: string;
}

/** COPY-UNSIGNED: the group headings of section B. */
export const ABILITY_GROUPS: readonly AbilityGroup[] = [
  { id: 'offers', label: 'Offers' },
  { id: 'trades', label: 'Trades' },
  { id: 'chat', label: 'Chat' },
  { id: 'proof', label: 'Proof' },
  { id: 'disputes', label: 'Disputes' },
  { id: 'wallets', label: 'Wallets and money' },
  { id: 'team', label: 'Team administration' },
  { id: 'security', label: 'Security and sessions' },
  { id: 'account', label: 'Account' },
];

type Row = [no: number, id: string, group: AbilityGroupId, label: string, does: string, risk: Risk, availability: Availability, hard: boolean, ruling: string | null, offers: 0 | 1, trades: 0 | 1, start: 0 | 1];

// COPY-UNSIGNED (every label and description below; checklist draft 9 Nov, section B).
// prettier-ignore
const ROWS: readonly Row[] = [
  // B1. Offers
  [1, 'offers-see', 'offers', 'See offers', 'See every offer, live or paused', 'low', 'grantable', false, 'Start set', 1, 1, 1],
  [2, 'offers-pause', 'offers', 'Pause or resume offers', 'Turn offers off and on', 'medium', 'grantable', false, '29 Oct bundle', 1, 0, 0],
  [3, 'offers-edit-prices', 'offers', 'Edit prices', 'Change the market percentage or fixed price', 'high', 'not-built', false, '29 Oct bundle', 1, 0, 0],
  [4, 'offers-edit-amounts', 'offers', 'Edit amounts and minimums', 'Change trade sizes and minimum completed trades', 'medium', 'not-built', false, '29 Oct bundle', 1, 0, 0],
  [5, 'offers-edit-methods', 'offers', 'Edit payment methods', 'Change which methods an offer takes, and its instructions', 'high', 'not-built', false, '29 Oct bundle', 1, 0, 0],
  [6, 'offers-edit-currencies', 'offers', 'Edit currencies', 'Change which currencies an offer is in', 'medium', 'not-built', false, '29 Oct bundle', 1, 0, 0],
  [7, 'offers-post', 'offers', 'Post a new offer', 'Create an offer, within the 3 buy + 3 sell limit', 'medium', 'grantable', false, '29 Oct bundle', 1, 0, 0],
  [8, 'offers-delete', 'offers', 'Delete an offer', 'Remove an offer for good', 'medium', 'grantable', false, '29 Oct bundle', 1, 0, 0],
  // B2. Trades
  [9, 'trades-see-active', 'trades', 'See active trades', "See the account's open trades", 'low', 'grantable', false, null, 1, 1, 0],
  [10, 'trades-see-history', 'trades', 'See trade history', 'See past trades: amounts, partners, dates', 'low', 'grantable', false, 'Start set', 0, 1, 1],
  [11, 'trades-export-history', 'trades', 'Export trade history', 'Download the history as a file', 'medium', 'not-built', false, null, 0, 0, 0],
  [12, 'trades-accept', 'trades', 'Accept a trade', 'Say yes to a trade request on your offer', 'high', 'waits-member-keys', false, '29 Oct bundle; needs member keys first', 0, 1, 0],
  [13, 'trades-take', 'trades', "Take someone's offer", "Start a trade from another trader's offer", 'high', 'waits-member-keys', false, '29 Oct bundle; needs member keys first', 0, 1, 0],
  [14, 'trades-decline', 'trades', 'Decline a trade', 'Say no to a trade request', 'low', 'not-built', false, 'Start set', 1, 1, 1],
  [15, 'trades-pick-wallet', 'trades', 'Pick the payout wallet', 'Choose which of your wallets a trade pays into', 'medium', 'waits-member-keys', false, 'Your list only; needs member keys first', 0, 1, 0],
  [16, 'trades-mark-paid', 'trades', 'Mark "I\'ve paid"', 'Tell the seller your money was sent', 'high', 'grantable', false, '29 Oct bundle', 0, 1, 0],
  [17, 'trades-extend', 'trades', 'Give more time', 'Give the buyer 30 more minutes to pay', 'low', 'grantable', false, null, 0, 1, 0],
  [18, 'trades-cancel', 'trades', 'Cancel a trade', 'Cancel or agree a cancel where the rules allow', 'medium', 'grantable', false, 'Built in Trades role', 0, 1, 0],
  [19, 'trades-cancel-no-show', 'trades', 'Cancel a no-show', 'Get the refund when the buyer never paid', 'medium', 'grantable', false, 'Built in Trades role', 0, 1, 0],
  [20, 'trades-confirm-cancel', 'trades', 'Confirm cancel', 'Close a cancelled trade once the XMR is back', 'low', 'grantable', false, 'Built in Trades role', 0, 1, 0],
  [21, 'trades-confirm-received', 'trades', 'Confirm payment received', "Say the buyer's money arrived", 'high', 'owner-only', true, 'Lead only (p10-2)', 0, 0, 0],
  // Owner question trades-release (26 Nov 2026, pending the owner's final yes; migration 870): was a
  // hard owner-only rule (p10-2). Now a box only the account holder ticks, per member, off in every
  // preset and role; it needs Hold trade keys (67) too (`ABILITY_REQUIRES`), and each release by a
  // member needs confirm-it's-you with a key (`release-trade`, never an authenticator code) and is
  // in the team log under the member's name. To back out: restore this row to 'owner-only', true.
  [22, 'trades-release', 'trades', 'Release coins', "Release a trade's coins with the synced trade keys; needs Hold trade keys, and a passkey, security key or PGP key each time", 'high', 'grantable', false, 'Owner question trades-release (26 Nov): only members the lead assigns', 0, 0, 0],
  [23, 'trades-fund', 'trades', 'Fund the escrow', 'Pay XMR into escrow when you sell', 'high', 'waits-member-keys', false, 'Lead only until member keys exist', 0, 0, 0],
  [24, 'trades-review', 'trades', 'Leave a review', 'Rate the partner after a trade', 'medium', 'not-built', false, null, 0, 0, 0],
  // B3. Chat
  [25, 'chat-read', 'chat', 'Read trade chats', 'Read the chat of any trade', 'low', 'waits-member-chat-key', false, 'Start set', 1, 1, 1],
  [26, 'chat-reply', 'chat', 'Reply in trade chats', 'Write to partners as your team', 'medium', 'waits-member-chat-key', false, 'Start set', 1, 1, 1],
  [27, 'chat-pretrade', 'chat', 'Read and reply to pre-trade chats', 'Answer people asking about your offers', 'medium', 'waits-member-chat-key', false, null, 1, 1, 0],
  [28, 'chat-payment-details', 'chat', 'Send payment details', 'Send your bank or app details with the payment form', 'high', 'waits-member-chat-key', false, null, 0, 0, 0],
  [29, 'chat-nudge', 'chat', 'Nudge', 'Send the wake-up nudge to a partner', 'low', 'not-built', false, 'Start set', 1, 1, 1],
  [30, 'traders-block', 'chat', 'Block a trader', 'Block someone; you see it in the log and can undo it', 'medium', 'not-built', false, 'p7-6', 0, 0, 0],
  [31, 'notes-view', 'chat', 'View notes on traders', "Read the account's private notes on traders", 'low', 'grantable', false, 'p7-8', 0, 0, 0],
  [32, 'notes-add', 'chat', 'Add notes on traders', 'Add a note, signed with name and time; no deleting', 'low', 'grantable', false, 'p7-8', 0, 0, 0],
  // B4. Proof
  [33, 'proof-upload', 'proof', 'Upload proof', 'Attach a payment photo or video', 'medium', 'waits-member-chat-key', false, '29 Oct bundle', 0, 1, 0],
  [34, 'proof-see-partner', 'proof', "See the partner's proof", 'See the proof the other side uploaded', 'low', 'waits-member-chat-key', false, null, 0, 1, 0],
  [35, 'proof-blur-check', 'proof', 'Answer the blur check', 'Say whether the blur hid private details', 'low', 'waits-member-chat-key', false, null, 0, 1, 0],
  // B5. Disputes
  [36, 'disputes-open', 'disputes', 'Open a dispute', 'Call a moderator in on a trade', 'medium', 'owner-only', true, 'Only trade parties open disputes (D-066, p7-7)', 0, 0, 0],
  [37, 'disputes-answer', 'disputes', 'Answer the moderator', 'See the whole dispute room and reply', 'high', 'grantable', false, 'Start set; p7-7', 1, 1, 1],
  [38, 'disputes-appeal', 'disputes', 'File an appeal', 'Appeal a ruling within 48 hours', 'medium', 'grantable', false, 'Built in Trades role', 0, 1, 0],
  // B6. Wallets and money
  [39, 'wallets-see', 'wallets', 'See wallet names', 'See the wallet list (names and address endings)', 'low', 'grantable', false, null, 0, 1, 0],
  [40, 'wallets-see-payouts', 'wallets', 'See payout amounts', 'See how much XMR reached your wallets', 'medium', 'not-built', false, null, 0, 0, 0],
  [41, 'wallets-see-fees', 'wallets', 'See fees paid', 'See the 1% fees the account paid', 'low', 'not-built', false, null, 0, 0, 0],
  [42, 'wallets-manage', 'wallets', 'Add or remove wallets', 'Change where your money goes', 'high', 'owner-only', true, 'Lead only', 0, 0, 0],
  [43, 'wallets-repay-lien', 'wallets', 'Repay a lien', 'Start the repayment trade that lifts a lien', 'high', 'not-built', false, null, 0, 0, 0],
  // B7. Team administration
  [44, 'team-see', 'team', 'See the team', 'See who is on the team and what each may do', 'low', 'not-built', false, null, 1, 1, 0],
  [45, 'team-see-log', 'team', 'See the team log', 'See who did what, and when', 'low', 'not-built', false, 'Start set', 1, 1, 1],
  [49, 'team-invite', 'team', 'Invite members', 'Send a team invite', 'high', 'owner-only', true, 'Lead only', 0, 0, 0],
  [50, 'team-remove', 'team', 'Remove members', 'Kick a member out', 'high', 'owner-only', true, 'Lead only (G57)', 0, 0, 0],
  [51, 'team-change-abilities', 'team', 'Change abilities', "Tick or untick another member's boxes", 'high', 'owner-only', true, 'Lead only', 0, 0, 0],
  // B8. Security and sessions
  [52, 'own-login-methods', 'security', 'Own login methods', 'Set up their own login, any strength', 'low', 'always', false, 'Always on (p7-9)', 0, 0, 0],
  [53, 'own-recovery-codes', 'security', 'Own recovery codes', 'Make their own recovery codes', 'low', 'always', false, 'Always on (p11-28)', 0, 0, 0],
  [54, 'own-session-extend', 'security', 'Extend own session', 'Stay logged in with their own login', 'low', 'always', false, 'Always on (Q73)', 0, 0, 0],
  [55, 'account-security', 'security', 'Account security settings', "Change the account's logins or timers", 'high', 'owner-only', true, 'Lead only', 0, 0, 0],
  [56, 'sessions-end-others', 'security', "End others' sessions", 'Log out other devices or members', 'high', 'owner-only', true, 'Lead only', 0, 0, 0],
  [57, 'devices-approve', 'security', 'Approve new devices', 'Let a new device into the account', 'high', 'owner-only', true, 'Lead only', 0, 0, 0],
  // B9. Account
  [58, 'reviews-see', 'account', 'See reviews', 'Read the reviews on your profile', 'low', 'not-built', false, 'Start set', 1, 1, 1],
  [59, 'reviews-reply', 'account', 'Reply to reviews', 'Post public replies in your name', 'medium', 'not-built', false, null, 0, 0, 0],
  [60, 'support-see', 'account', 'See support tickets', "Read the account's tickets to X2F staff", 'medium', 'not-built', false, null, 0, 0, 0],
  [61, 'support-open', 'account', 'Open support tickets', 'Write to X2F staff (shared limit of 10 a day)', 'low', 'not-built', false, 'Q69: shared across team', 0, 0, 0],
  [62, 'feedback-send', 'account', 'Send X2F feedback', 'Use "How\'s X2F doing?" (own limit)', 'low', 'grantable', false, 'Q69: per member', 1, 1, 0],
  [63, 'profile-edit', 'account', 'Edit profile', 'Change the Trade Tag or profile', 'medium', 'owner-only', false, 'Not ruled; lead suggests lead only', 0, 0, 0],
  [64, 'alerts-settings', 'account', 'Change alert settings', "Change the account's push and Jabber alerts", 'medium', 'owner-only', false, 'Lead only (lead default)', 0, 0, 0],
  [65, 'account-type', 'account', 'Account type', 'Become or stop being a vendor', 'high', 'owner-only', false, 'Lead only (design)', 0, 0, 0],
  [66, 'account-delete', 'account', 'Delete the account', 'Close the account for good', 'high', 'owner-only', true, 'Lead only', 0, 0, 0],
  // Owner 26 Nov 2026 (escrow-key sync, migration 860): the box IS the lead's assignment. With it the
  // lead's device also seals each trade's escrow keys to the member's own reader key, and the member
  // may open that copy (escrowSync/routes.ts). On its own it grants no signing; with Release coins
  // (22) the member may also release (owner question trades-release).
  [67, 'trades-escrow-keys', 'trades', 'Hold trade keys', "Keep an encrypted copy of the account's trade escrow keys; never releases XMR", 'high', 'grantable', false, 'Owner 26 Nov: only members the lead assigns', 0, 0, 0],
];

export const ABILITIES: readonly Ability[] = ROWS.map(([no, id, group, label, does, risk, availability, hard, ruling, offers, trades, start]) => ({
  no, id, group, label, does, risk, availability, hard, ruling, offers: offers === 1, trades: trades === 1, start: start === 1,
}));

export const ABILITY_IDS: readonly string[] = ABILITIES.map((a) => a.id);
const ORDER = new Map(ABILITY_IDS.map((id, i) => [id, i]));
const BY_ID = new Map(ABILITIES.map((a) => [a.id, a]));

/** The owner's hard rules: never a box, whatever a stored set says. */
export const HARD_OWNER_ONLY: ReadonlySet<string> = new Set(ABILITIES.filter((a) => a.availability === 'owner-only' && a.hard).map((a) => a.id));
/** Every member has these; they are not boxes. */
export const ALWAYS_ON: ReadonlySet<string> = new Set(ABILITIES.filter((a) => a.availability === 'always').map((a) => a.id));
/** The boxes: what a member's stored set may hold. */
export const GRANTABLE: ReadonlySet<string> = new Set(
  ABILITIES.filter((a) => a.availability !== 'owner-only' && a.availability !== 'always').map((a) => a.id),
);

export type PresetId = 'offers' | 'trades' | 'manager' | 'start';

export interface Preset {
  id: PresetId;
  /** COPY-UNSIGNED */
  label: string;
  /** COPY-UNSIGNED */
  note: string;
  abilities: readonly string[];
}

const ticked = (pick: (a: Ability) => boolean): string[] => ABILITIES.filter((a) => GRANTABLE.has(a.id) && pick(a)).map((a) => a.id);

/**
 * The presets. Offers and Trades: the checklist's columns (the owner's 29 Oct bundles); the start
 * set: the 10 boxes of design A (p7-12) less "Open a dispute" (D-066 makes it owner-only).
 * Manager (p7-5): the owner has not ticked its set yet; until he does it is both bundles together
 * (LEAD PLACEHOLDER, J-10 report: owner question).
 */
export const PRESETS: readonly Preset[] = [
  { id: 'offers', label: 'Offers', note: 'Create, delete, adjust and maintain offers', abilities: ticked((a) => a.offers) },
  { id: 'trades', label: 'Trades', note: 'Accept trades, upload proof, mark money sent, complete transactions', abilities: ticked((a) => a.trades) },
  { id: 'manager', label: 'Manager', note: 'A recommended set; untick any box', abilities: ticked((a) => a.offers || a.trades) },
  { id: 'start', label: 'Start set', note: 'The boxes every new member starts with', abilities: ticked((a) => a.start) },
];

/** The preset `abilities` matches exactly, or null ("Custom"). */
export function presetOf(abilities: readonly string[]): PresetId | null {
  const set = new Set(abilities);
  const p = PRESETS.find((x) => x.abilities.length === set.size && x.abilities.every((id) => set.has(id)));
  return p?.id ?? null;
}

/** A route's need: `any` (every member), one ability, or any one of several. */
export type AbilityNeed = 'any' | string | readonly string[];

/** A member's abilities: the stored boxes (only grantable ones count) and the always-on ones. */
export function effectiveAbilities(stored: readonly string[]): Set<string> {
  const out = new Set<string>(ALWAYS_ON);
  for (const id of stored) if (GRANTABLE.has(id)) out.add(id);
  return out;
}

/** True when a member holding `stored` meets `need`. A hard owner-only ability is never met. */
export function hasAbility(stored: readonly string[], need: AbilityNeed): boolean {
  if (need === 'any') return true;
  const have = effectiveAbilities(stored);
  const needs = typeof need === 'string' ? [need] : need;
  return needs.some((id) => !HARD_OWNER_ONLY.has(id) && have.has(id) && (ABILITY_REQUIRES[id] ?? []).every((r) => have.has(r)));
}

/**
 * Boxes that only work together with others (owner question trades-release, 26 Nov 2026): Release
 * coins signs with the synced trade keys, so it needs Hold trade keys. A set holding one without
 * all it needs is refused (`parseAbilities`: 400 `release-needs-trade-keys`; migration 870's check)
 * and never met (`hasAbility`). So unticking Hold trade keys means unticking Release coins too.
 */
export const ABILITY_REQUIRES: Readonly<Record<string, readonly string[]>> = {
  'trades-release': ['trades-escrow-keys'],
};

/** The ids in `stored` that lack a box they need (`ABILITY_REQUIRES`). */
export function missingRequirements(stored: readonly string[]): string[] {
  const set = new Set(stored);
  return Object.entries(ABILITY_REQUIRES)
    .filter(([id, needs]) => set.has(id) && needs.some((n) => !set.has(n)))
    .map(([id]) => id);
}

/**
 * Parses an abilities list from a request body: a non-empty set of grantable ids, in catalogue
 * order. 400 `bad-request` otherwise, and 400 `release-needs-trade-keys` for Release coins without
 * Hold trade keys (`ABILITY_REQUIRES`).
 */
export function parseAbilities(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > GRANTABLE.size) throw new ApiError(400, 'bad-request');
  const set = new Set<string>();
  for (const id of raw) {
    if (typeof id !== 'string' || !GRANTABLE.has(id) || set.has(id)) throw new ApiError(400, 'bad-request');
    set.add(id);
  }
  if (missingRequirements([...set]).length > 0) throw new ApiError(400, 'release-needs-trade-keys');
  return sortAbilities([...set]);
}

export function sortAbilities(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (ORDER.get(a) ?? 1e9) - (ORDER.get(b) ?? 1e9));
}

export function abilityOf(id: string): Ability | undefined {
  return BY_ID.get(id);
}

// ---------------------------------------------------------------------------------------------
// The roles of 29 Oct (Plan 2 Task 18), kept for the web until it renders the boxes

export type TeamRole = 'offers' | 'trades';
/** In their fixed order (the confirm's `roles` lists them in this order). */
export const TEAM_ROLES: readonly TeamRole[] = ['offers', 'trades'];

/**
 * What each old role let a member do, as boxes (migration 360 moved every member's roles to these,
 * and `roles` in a request body still maps to them): exactly what the API allowed the role before,
 * so the move widens nobody's access. Offers also gets the not-built edit boxes the role's bundle
 * named ("adjust and maintain offers"). Trades loses opening a dispute (D-066, owner-only now).
 * Pinned here and in migration 360 (a test checks they agree).
 */
export const ROLE_ABILITIES: Readonly<Record<TeamRole, readonly string[]>> = {
  offers: ['offers-see', 'offers-pause', 'offers-edit-prices', 'offers-edit-amounts', 'offers-edit-methods', 'offers-edit-currencies', 'offers-post', 'offers-delete', 'feedback-send'],
  trades: [
    'trades-see-active', 'trades-see-history', 'trades-accept', 'trades-take', 'trades-pick-wallet', 'trades-mark-paid', 'trades-extend', 'trades-cancel',
    'trades-cancel-no-show', 'trades-confirm-cancel', 'disputes-answer', 'disputes-appeal', 'wallets-see', 'feedback-send',
  ],
};

export function rolesToAbilities(roles: readonly TeamRole[]): string[] {
  return sortAbilities([...new Set(roles.flatMap((r) => ROLE_ABILITIES[r]))]);
}

/**
 * The old roles a set still reads as, for the web's `roles` (Offers: may post; Trades: sees active
 * trades).
 */
export function legacyRoles(abilities: readonly string[]): TeamRole[] {
  const out: TeamRole[] = [];
  if (abilities.includes('offers-post')) out.push('offers');
  if (abilities.includes('trades-see-active')) out.push('trades');
  return out;
}

/** True when the old roles do not describe the set exactly (review 2026-11-09 m3: the web's roles view then says "Custom"). */
export function isCustomSet(abilities: readonly string[]): boolean {
  const back = rolesToAbilities(legacyRoles(abilities));
  const set = new Set(abilities);
  return back.length !== set.size || back.some((id) => !set.has(id));
}

/** Parses a roles list from a request body (the old shape): a non-empty set of known roles. */
export function parseRoles(raw: unknown): TeamRole[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TEAM_ROLES.length) throw new ApiError(400, 'bad-request');
  const set = new Set<string>();
  for (const r of raw) {
    if (typeof r !== 'string' || !(TEAM_ROLES as readonly string[]).includes(r) || set.has(r)) throw new ApiError(400, 'bad-request');
    set.add(r);
  }
  return TEAM_ROLES.filter((r) => set.has(r));
}

/** The catalogue as `GET /v1/team/permissions` answers it. */
export function catalogueView(): {
  groups: (AbilityGroup & { abilities: (Ability & { presets: PresetId[] })[] })[];
  presets: Preset[];
  rules: string[];
} {
  return {
    groups: ABILITY_GROUPS.map((g) => ({
      ...g,
      abilities: ABILITIES.filter((a) => a.group === g.id).map((a) => ({ ...a, presets: PRESETS.filter((p) => p.abilities.includes(a.id)).map((p) => p.id) })),
    })),
    presets: PRESETS.map((p) => ({ ...p, abilities: [...p.abilities] })),
    // COPY-UNSIGNED: the owner's rules on top of the boxes.
    rules: [
      'Members never confirm payment received on your sell trades. Only a member you give Release coins (with Hold trade keys) can release, after confirming with a passkey, security key or PGP key.',
      'Payout wallets, team members, security settings and closing the account are yours alone.',
      'Only you or your trade partner open a dispute; a member with Answer the moderator can see it and reply.',
      'Every action a member takes is in the team log, with their name and the amount.',
    ],
  };
}

/**
 * Owner rule p5-7: what X2F may ever say over Jabber. A sender takes a `JabberMessage` and renders
 * one of these fixed texts itself (the notice kinds and the test code), so no caller can put anything else in a message: never what
 * changed, a name, an amount, a wallet, a trade or a link (the board's "Why no details": the
 * user's Jabber server, devices and password are outside X2F's control).
 */
import type { PreKeyLedger } from '@x2f/omemo';

/** The only account-change text (owner, 7 Nov; board JabberSetup). */
export const ACCOUNT_CHANGE_TEXT = 'An account change was made on your X2F account.';

/**
 * Lead default (2026-11-08), same opt-in: when a dispute is opened on a trade (both sides since migration 920).
 * COPY-UNSIGNED (the owner has not signed it; no board draws it).
 */
export const TRADE_ATTENTION_TEXT = 'A trade on your X2F account needs your attention.';

/**
 * J-20 (owner p11-27, S-107: "a notification and even a Jabber notification"), same opt-in: to the
 * team account when one of its members logs in for the first time (their join). Names no member.
 * COPY-UNSIGNED // DESIGN: wording (no board draws it).
 */
export const TEAM_FIRST_LOGIN_TEXT = 'A team member logged in to your X2F account for the first time.';

/**
 * Trade milestones (owner, 27 Nov 2026; migration 920), same opt-in, each on until the user turns
 * it off. Fixed sentences: no trade code, amount, person, method or link. COPY-UNSIGNED (builder's words).
 */
export const TRADE_MILESTONE_TEXT = Object.freeze({
  'trade-started': 'Someone started a new trade with you on X2F.',
  'trade-funded': 'The coins for one of your X2F trades are locked in escrow. You can pay now.',
  'trade-paid': 'A buyer marked a payment as sent on one of your X2F trades.',
  'trade-cancel-asked': 'Your trade partner asked to cancel one of your X2F trades.',
  'trade-completed': 'One of your X2F trades is complete.',
  'trade-cancelled': 'One of your X2F trades was cancelled or refunded.',
  'trade-ruled': 'A ruling was published on a dispute in one of your X2F trades.',
});

/** The notice kinds the outbox carries (`jabber_outbox.kind`, migrations 331, 380 and 920), in the order the picks page lists them; one fixed sentence each. */
export const NOTICE_KINDS = [
  'account-change', 'team-member-first-login',
  'trade-started', 'trade-funded', 'trade-paid', 'trade-cancel-asked', 'trade-completed', 'trade-cancelled', 'trade-attention', 'trade-ruled',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * Review F1 of wip/lead-jabber-settings (safe default until the owner rules on W-021's reach): the
 * security notices a user cannot turn off on the Jabber notifications page. `account-change` covers
 * payout wallets, login methods and recovery holds; J-20's `team-member-first-login` replaces the
 * lead's approval of a member's first login (p11-27), so it is listed ahead of J-20's landing.
 * The owner's ruling is a flip here, plus the matching `muted_kinds` check (migration 336 or a
 * later one), which refuses these kinds in the database too.
 */
export const ALWAYS_ON_KINDS: readonly string[] = ['account-change', 'team-member-first-login'];
export const NOTICE_TEXT: Readonly<Record<NoticeKind, string>> = Object.freeze({
  'account-change': ACCOUNT_CHANGE_TEXT,
  'trade-attention': TRADE_ATTENTION_TEXT,
  'team-member-first-login': TEAM_FIRST_LOGIN_TEXT,
  ...TRADE_MILESTONE_TEXT,
});

/** Who the message says it is from (XEP-0172 nickname; board: "X2F alerts"). */
export const SENDER_NAME = 'X2F alerts';

/** The set-up test message: the code and nothing else. COPY-UNSIGNED (the board shows no text for it). */
export const testCodeText = (code: string): string => `Your X2F test code is ${code}.`;

export type JabberMessage = { kind: NoticeKind } | { kind: 'test-code'; code: string };

export interface SendOptions {
  /**
   * The outbox pass this send belongs to (OMEMO review M2): the encryptor records in it which
   * one-time prekey of each recipient device it used, so a later notice in the same pass never picks
   * the same one (a client reads a prekey message once per prekey). A send outside a pass has none.
   */
  preKeys?: PreKeyLedger;
}

/**
 * A send that did not happen and should not count as a try: a recipient device has no one-time
 * prekey left in this outbox pass (lead decision after the interop run of 2026-11-10, step 4b; the
 * encryptor throws it). The outbox keeps the notice for its next pass, which fetches the bundle
 * again. The message is fixed.
 */
export class NoticeDeferred extends Error {
  constructor() {
    super('jabber: notice deferred');
    this.name = 'NoticeDeferred';
  }
}

export function messageText(m: JabberMessage): string {
  if (m.kind === 'test-code') {
    if (!/^[0-9]{6}$/.test(m.code)) throw new Error('jabber: a test code is six digits');
    return testCodeText(m.code);
  }
  if (!Object.hasOwn(NOTICE_TEXT, m.kind)) throw new Error('jabber: unknown notice kind');
  return NOTICE_TEXT[m.kind];
}

/**
 * Delivers one message to a bare address. Resolves once X2F's server accepted it; rejects on any
 * failure with an error that never quotes the address (callers may log `e.message`'s absence only).
 */
export interface JabberSender {
  send(to: string, message: JabberMessage, o?: SendOptions): Promise<void>;
}

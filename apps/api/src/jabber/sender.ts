/**
 * Owner rule p5-7: what X2F may ever say over Jabber. A sender takes a `JabberMessage` and renders
 * one of these fixed texts itself (the notice kinds and the test code), so no caller can put anything else in a message: never what
 * changed, a name, an amount, a wallet, a trade or a link (the board's "Why no details": the
 * user's Jabber server, devices and password are outside X2F's control).
 */

/** The only account-change text (owner, 7 Nov; board JabberSetup). */
export const ACCOUNT_CHANGE_TEXT = 'An account change was made on your X2F account.';

/**
 * Lead default (2026-11-08), same opt-in: to the payer when a dispute is opened on their trade.
 * COPY-UNSIGNED (the owner has not signed it; no board draws it).
 */
export const TRADE_ATTENTION_TEXT = 'A trade on your X2F account needs your attention.';

/** The notice kinds the outbox carries (`jabber_outbox.kind`, migration 331); one fixed sentence each. */
export const NOTICE_KINDS = ['account-change', 'trade-attention'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NOTICE_TEXT: Readonly<Record<NoticeKind, string>> = Object.freeze({
  'account-change': ACCOUNT_CHANGE_TEXT,
  'trade-attention': TRADE_ATTENTION_TEXT,
});

/** Who the message says it is from (XEP-0172 nickname; board: "X2F alerts"). */
export const SENDER_NAME = 'X2F alerts';

/** The set-up test message: the code and nothing else. COPY-UNSIGNED (the board shows no text for it). */
export const testCodeText = (code: string): string => `Your X2F test code is ${code}.`;

export type JabberMessage = { kind: NoticeKind } | { kind: 'test-code'; code: string };

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
  send(to: string, message: JabberMessage): Promise<void>;
}

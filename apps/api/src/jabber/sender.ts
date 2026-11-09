/**
 * Owner rule p5-7: what X2F may ever say over Jabber. A sender takes a `JabberMessage` and renders
 * one of these two fixed texts itself, so no caller can put anything else in a message: never what
 * changed, a name, an amount, a wallet, a trade or a link (the board's "Why no details": the
 * user's Jabber server, devices and password are outside X2F's control).
 */

/** The only account-change text (owner, 7 Nov; board JabberSetup). */
export const ACCOUNT_CHANGE_TEXT = 'An account change was made on your X2F account.';

/** Who the message says it is from (XEP-0172 nickname; board: "X2F alerts"). */
export const SENDER_NAME = 'X2F alerts';

/** The set-up test message: the code and nothing else. COPY-UNSIGNED (the board shows no text for it). */
export const testCodeText = (code: string): string => `Your X2F test code is ${code}.`;

export type JabberMessage = { kind: 'account-change' } | { kind: 'test-code'; code: string };

export function messageText(m: JabberMessage): string {
  if (m.kind === 'account-change') return ACCOUNT_CHANGE_TEXT;
  if (!/^[0-9]{6}$/.test(m.code)) throw new Error('jabber: a test code is six digits');
  return testCodeText(m.code);
}

/**
 * Delivers one message to a bare address. Resolves once X2F's server accepted it; rejects on any
 * failure with an error that never quotes the address (callers may log `e.message`'s absence only).
 */
export interface JabberSender {
  send(to: string, message: JabberMessage): Promise<void>;
}

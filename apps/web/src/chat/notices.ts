/**
 * Fixed chat notices (P-020): lines an app sends on its own, in the encrypted chat, with wording
 * no one types. The chat is end-to-end encrypted, so the server cannot write into it; a notice is
 * sealed by a trader's own device as `{ text, notice }` in an ordinary `chat.msg` envelope
 * (chatCrypto's sealChatNotice). Every reader checks the sealed text is exactly this wording, and
 * shows its own copy of it, never the line's text.
 *
 * Only a trader's device sends one, so it is only as trustworthy as that device: a poster who
 * skips the app can leave it out (the receiver's own proof check still flags a missing code), and
 * any trader can send the fixed words at any time. They are not tied to one proof.
 */

// COPY-UNSIGNED (P-020): the owner words each notice.
export const CHAT_NOTICES = {
  /** The proof poster's own blur covered the trade code (uploadPrompts' `hidden.memo`). */
  'proof-code-hidden': 'Automated proof check: the trade code was covered in this proof.',
} as const;

export type ChatNoticeId = keyof typeof CHAT_NOTICES;

/** A known notice id (own keys only: never 'toString' or another inherited name). */
export function isChatNotice(x: unknown): x is ChatNoticeId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(CHAT_NOTICES, x);
}

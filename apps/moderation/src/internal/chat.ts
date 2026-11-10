import { seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { CHAT_BODY_MAX_BYTES, CHAT_MSG_TYPE, CHAT_TEXT_MAX_BYTES } from '@x2f/trade';

/**
 * The moderator's side of a trade chat (Plan 4 Task 11): sealing the moderator's own messages
 * with the chat's moderator identity (@x2f/protocol's seal). The message format is the trader
 * app's (apps/web chatCrypto): inner type `chat.msg`, payload exactly `{ text }`; a moderator's
 * message is told apart by its verified sender `mod`, never by anything in the payload, so a
 * trader can never make one.
 *
 * NEEDS_P4_CHAT_MEMBERSHIP: opening the chat for the moderator is not built here on purpose (the
 * per-trade key-membership design, owner p11-2, replaces opening it in this process: build task 9
 * of design-chat-membership-keys-2026-11-08).
 */

export class ChatTextError extends Error {
  constructor() {
    super('bad text');
    this.name = 'ChatTextError';
  }
}

// Control characters other than tab and line feed (the trader app refuses the same and more).
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** A moderator's message text: not blank, no control characters, at most CHAT_TEXT_MAX_BYTES of UTF-8. */
export function checkModText(text: unknown): string {
  if (typeof text !== 'string' || text.trim() === '' || CONTROL.test(text)) throw new ChatTextError();
  if (new TextEncoder().encode(text).length > CHAT_TEXT_MAX_BYTES) throw new ChatTextError();
  return text;
}

/**
 * Seals one moderator message to buyer, seller and the moderator itself (so the case view can read
 * it back). Throws ChatTextError for a bad text or one whose envelope would exceed the API's size limit.
 */
export async function sealModMessage(a: { channel: string; seq: number; mod: Identity; participants: Participants; text: string }): Promise<Envelope> {
  const text = checkModText(a.text);
  const envelope = await seal({
    trade: a.channel,
    from: 'mod',
    seq: a.seq,
    type: CHAT_MSG_TYPE,
    payload: { text },
    to: ['buyer', 'seller', 'mod'],
    me: a.mod,
    participants: a.participants,
  });
  if (new TextEncoder().encode(JSON.stringify(envelope)).length > CHAT_BODY_MAX_BYTES) throw new ChatTextError();
  return envelope;
}

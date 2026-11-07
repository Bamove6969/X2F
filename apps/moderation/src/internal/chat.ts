import type { Role } from '@x2f/core';
import { open, ReplayGuard, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { CHAT_BODY_MAX_BYTES, CHAT_MSG_TYPE, CHAT_TEXT_MAX_BYTES } from '@x2f/trade';
import type { EnvelopeRow } from './apiView.js';

/**
 * The moderator's side of a trade chat (Plan 4 Task 11): opening the stored envelopes with the
 * chat's moderator identity, and sealing the moderator's own messages. Crypto is @x2f/protocol's
 * seal/open only. The message format is the trader app's (apps/web chatCrypto): inner type
 * `chat.msg`, payload exactly `{ text }`; a moderator's message is told apart by its verified
 * sender `mod`, never by anything in the payload, so a trader can never make one.
 */

/** One message as the moderator's case view shows it. */
export interface ChatMessage {
  from: Role;
  at: string;
  text: string;
  /** `text` from a trader, `moderator` from the moderator, `unreadable` when it does not open. */
  type: 'text' | 'moderator' | 'unreadable';
}

export class ChatTextError extends Error {
  constructor() {
    super('bad text');
    this.name = 'ChatTextError';
  }
}

const ROLES: readonly string[] = ['buyer', 'seller', 'mod'];
// Control characters other than tab and line feed (the trader app refuses the same and more).
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** A moderator's message text: not blank, no control characters, at most CHAT_TEXT_MAX_BYTES of UTF-8. */
export function checkModText(text: unknown): string {
  if (typeof text !== 'string' || text.trim() === '' || CONTROL.test(text)) throw new ChatTextError();
  if (new TextEncoder().encode(text).length > CHAT_TEXT_MAX_BYTES) throw new ChatTextError();
  return text;
}

/**
 * Opens a chat's envelopes in order. One that does not open (bad signature, not for the moderator,
 * a replay, a stored sender that is not its verified sender, or not a chat message) is listed as
 * `unreadable` with no text, so the moderator sees that something is there.
 */
export async function readChat(a: { channel: string; mod: Identity; participants: Participants; rows: readonly EnvelopeRow[] }): Promise<ChatMessage[]> {
  const guard = new ReplayGuard(a.channel);
  const out: ChatMessage[] = [];
  for (const r of a.rows) {
    const at = r.at.toISOString();
    const stored = ROLES.includes(r.senderRole) ? (r.senderRole as Role) : 'mod';
    try {
      const o = await open(r.envelope, { me: a.mod, myRole: 'mod', participants: a.participants, trade: a.channel, guard, allowSelf: true });
      const p = o.payload as Record<string, unknown> | null;
      const ok =
        o.from === r.senderRole &&
        o.type === CHAT_MSG_TYPE &&
        p !== null && typeof p === 'object' && !Array.isArray(p) &&
        Object.keys(p).length === 1 && typeof p.text === 'string';
      if (!ok) {
        out.push({ from: stored, at, text: '', type: 'unreadable' });
        continue;
      }
      out.push({ from: o.from, at, text: p.text as string, type: o.from === 'mod' ? 'moderator' : 'text' });
    } catch {
      out.push({ from: stored, at, text: '', type: 'unreadable' });
    }
  }
  return out;
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

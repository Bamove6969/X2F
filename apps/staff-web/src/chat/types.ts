/**
 * Design build task 10 (design section 2.4 M4, the staff-web reader): what the page and the chat
 * key worker (`src/keys/`) say to each other, and nothing else. The page never holds a chat key or
 * a device secret: it sends the API's ciphertext answer and the moderator's plaintext to the
 * worker, and gets back the lines to show, the sealed message to post, and the device's public
 * keys. This module holds only types, the read cap and the text rule, so the page bundle carries
 * no crypto (test/workerBoundary.test.ts checks the page never imports the key-handling code).
 */

/** The most envelopes one read returns (the API's CHAT_READ_MAX): the newest ones. */
export const CASE_CHAT_READ_MAX = 5000;

/**
 * The chat's text cap in UTF-8 bytes: @x2f/trade's CHAT_TEXT_MAX_BYTES, written here so the page
 * imports no crypto package (test/workerBoundary.test.ts checks the two agree).
 */
export const MOD_TEXT_MAX_BYTES = 2000;

/** A private lane: the one trader it is with (owner 27 Nov). */
export type Lane = 'buyer' | 'seller';

/** What `POST /staff/v1/disputes/:code/chat` answers: ciphertext only. */
export interface CaseChatAnswer {
  chat: string;
  channel: string;
  wrap: string;
  tkh: string;
  nextSeq: number;
  attestation: { attestation: unknown; sig: string } | null;
  record: unknown;
  /**
   * Private lanes (owner 27 Nov): each trader's lane key PK re-wrapped to this device, pinned by its
   * `pkh`, the moderator's next seq in that lane, and the lane record the attested moderator signed
   * (naming the lane and pkh; the reader refuses the lane without it). Missing (an older API) is no lanes.
   */
  lanes?: Array<{ to: Lane; pkh: string; wrap: string; nextSeq: number; record: unknown }>;
  /** `to`: the lane of a private (v3) envelope, null (or missing) for the shared chat. */
  envelopes: Array<{ id: string; senderRole: string; envelope: unknown; at: string; to?: Lane | null }>;
  /** Review N11 (f): the chat has more envelopes than one read returns; these are the newest. */
  olderNotShown?: boolean;
}

/**
 * The lane control message's type (owner 27 Nov follow-up): `{type: 'chat.mode', payload: {on}}`,
 * sealed by the moderator in a lane whenever "Talking to" changes. Written here so the page imports
 * no crypto package.
 */
export const CHAT_MODE_TYPE = 'chat.mode';

/** Owner 27 Nov (follow-up): the moderator turned private mode on or off in lane `to` (a system line, not a message). */
export interface CaseChatModeLine {
  kind: 'mode';
  id: string;
  from: 'mod';
  to: Lane;
  on: boolean;
  at: string;
  missingBefore: number;
  text?: undefined;
}

export type CaseChatLine = CaseChatTextLine | CaseChatModeLine;

/** A message line. */
export interface CaseChatTextLine {
  kind?: 'text';
  id: string;
  from: 'buyer' | 'seller' | 'mod';
  text: string;
  at: string;
  /** Review N2: how many of this sender's messages are missing just before this line (0: none). */
  missingBefore: number;
  /** A private line: only the moderator and this trader see it (every staff reader too). */
  to?: Lane;
}

/** An opened chat as the page sees it: the worker keeps its key, under `handle`. */
export interface ChatView {
  /** The worker's name for this opened chat (no key material). */
  handle: string;
  nextSeq: number;
  /** The moderator's next seq in each private lane the chat has (no entry: no such lane). */
  nextSeqByLane: { buyer?: number; seller?: number };
  lines: CaseChatLine[];
  /** Envelopes that did not verify or open (shown as a count, never as text). */
  unreadable: number;
  /** Review N2: messages missing in all. */
  missing: number;
  /** Review N11 (f): older messages are not shown (the read is cut at CASE_CHAT_READ_MAX). */
  olderNotShown: boolean;
}

/** What `POST …/messages` takes: the message sealed under the chat key at `seq` and countersigned by this device. */
export interface SealedModMessage {
  deviceKeyId: string;
  seq: number;
  nonce: string;
  ct: string;
  ctSha256: string;
  requestId: string;
  issuedAt: string;
  sig: string;
  /** A private message's lane (a v3 body, the lane countersign); absent for both traders. */
  to?: Lane;
}

/** This browser's device key, its public halves only (what the person certifies). */
export interface DevicePublic {
  deviceKeyId: string;
  signPublic: string;
  boxPublic: string;
}

/**
 * Why the worker said no: `security` (what the server sent did not check out, or a key that is not
 * the chat's), `unreadable` (a text the chat does not take), `unavailable` (this browser cannot
 * keep a device key or run the worker), `crypto-unavailable` (the crypto library could not load
 * in the worker, e.g. WebAssembly refused), `bad-record` (the stored device key does not open),
 * `gone` (no such opened chat), `fault` (anything else).
 */
export type ChatKeyErrorCode = 'security' | 'unreadable' | 'unavailable' | 'crypto-unavailable' | 'bad-record' | 'gone' | 'fault';
export const CHAT_KEY_ERROR_CODES: readonly ChatKeyErrorCode[] = ['security', 'unreadable', 'unavailable', 'crypto-unavailable', 'bad-record', 'gone', 'fault'];

export class ChatKeyError extends Error {
  constructor(readonly code: ChatKeyErrorCode) {
    super(code);
    this.name = 'ChatKeyError';
  }
}

// Control characters other than tab and line feed (as the trader app and the old moderator route refused).
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** A moderator message's text: not blank, no control characters, at most MOD_TEXT_MAX_BYTES of UTF-8. */
export function modTextOk(text: string): boolean {
  return typeof text === 'string' && text.trim() !== '' && !CONTROL.test(text) && new TextEncoder().encode(text).length <= MOD_TEXT_MAX_BYTES;
}

export { ProtocolError, type ProtocolErrorCode } from './errors.js';
export { generateIdentity, signProof, type Identity } from './identity.js';
export { SEALED_OVERHEAD, generateBoxKeyPair, openSealed, sealTo, type BoxKeyPair } from './sealed.js';
export { ReplayGuard, type ReplayGuardJSON } from './replay.js';
export { joinMessage } from './join.js';
export {
  ENVELOPE_KEYS,
  open,
  seal,
  type Envelope,
  type OpenArgs,
  type Opened,
  type Participants,
  type PublicKeys,
  type SealArgs,
} from './envelope.js';
export { canonicalJson } from './payload.js';
export { hasExactKeys, isPlainObject, isValidSeq } from './roles.js';
export {
  CHAT_ENVELOPE_V2_KEYS,
  CHAT_GRANT_KEYS,
  CHAT_KEY_BYTES,
  CHAT_KEY_RECORD_KEYS,
  DISPUTE_NOTICE_KEYS,
  chatKeyHash,
  makeChatGrant,
  makeChatKeyRecord,
  makeDisputeNotice,
  newChatKey,
  openChat,
  openChatKeyRecord,
  sealChat,
  unwrapChatKey,
  verifyChatGrant,
  verifyChatKeyRecord,
  verifyDisputeNotice,
  wrapChatKey,
  type ChatEnvelopeV2,
  type ChatGrant,
  type ChatKeyRecord,
  type DisputeNotice,
  type OpenChatArgs,
  type SealChatArgs,
} from './chatV2.js';

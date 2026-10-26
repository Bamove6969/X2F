export { ProtocolError, type ProtocolErrorCode } from './errors.js';
export { generateIdentity, type Identity } from './identity.js';
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

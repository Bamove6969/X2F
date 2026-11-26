// Plan 4 Task 13: the ruling gate.
export { gateCheck, startGateSync } from './check.js';
export { fileGateAttestation } from './attestation.js';
export { pinOwner, type PinResult } from './pin.js';
export { pgGateSource, syncRegistry, type GateSource, type PgGateSource, type StoredRulings } from './registry.js';
export { DEFAULT_APPEAL_WINDOW_H, DEFAULT_LIMIT_USD_CENTS, GATE_FILE, GATE_LOCK_FILE, emptyGate, forgetTrade, GATE_OTHER_FIELDS, GATE_TRADE_FIELDS, initGate, openGateStore, tradeRulingPending, type GateState, type GateStore, type InitResult, type PinnedCred, type RulingExecution, type RulingSeen, type StaffEntry } from './store.js';
export {
  authorizeRuling,
  gateNeedsSecond,
  noteCounter,
  recordedTerms,
  verifyTap,
  type Authorization,
  type GateAttestation,
  type GateContext,
  type GateRefusal,
  type GateRuling,
  type RecordedTerms,
  type RelyingParty,
  type RulingInput,
  type StoredTap,
} from './verify.js';

// @x2f/staff: the pure staff rules shared by the API, the moderation process and the staff web
// app (Plan 4): roles and permissions, login hours, key-tap intents and the dispute state machine.
// No I/O; it runs in the browser too.
export { canonicalJson } from './canonical.js';
export { sha256 } from './sha256.js';
export {
  GRANTABLE_PERMS,
  NAV,
  navFor,
  PERMS,
  STAFF_ROLES,
  can,
  type GrantablePerm,
  type NavItem,
  type Perm,
  type StaffRole,
} from './roles.js';
export { HoursError, WEEKDAYS, inWindow, validateHours, windowEndsAt, type LoginHours, type Weekday } from './hours.js';
export {
  AFTER_REFUND_OUTCOMES,
  BAN_REASON_CODES,
  ESCROW_OUTCOMES,
  KEY_TAP_KINDS,
  inviteRegistrationChallenge,
  keyCheckCode,
  tapChallenge,
  type AccountAction,
  type AfterRefundOutcome,
  type BanReasonCode,
  type EscrowOutcome,
  type KeyTapIntent,
  type RulingOutcome,
} from './intent.js';
export {
  APPEAL_GOAL_H,
  COMPLY_H,
  DisputeRuleError,
  RULING_DEADLINE_H,
  RULING_GOAL_H,
  applyDispute,
  markSeen,
  needsSecond,
  newDispute,
  rulingFee,
  shiftDeadlines,
  traderStatus,
  type Actor,
  type Dispute,
  type DisputeEvent,
  type DisputeRuleCode,
  type DisputeSettings,
  type DisputeStatus,
  type Round1,
  type RulingDraft,
  type RulingFee,
  type TraderDisputeStatus,
} from './dispute.js';
export { appealReviewers, involvedIn, type InvolvementEntry } from './appealReviewers.js';
export { INCIDENT_ALPHABET, INCIDENT_ID_LENGTH, incidentCheckChar, isIncidentId, normalizeIncidentId } from './incident.js';

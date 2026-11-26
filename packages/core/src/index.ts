export const CORE_READY = true;

export { type Role, ROLES } from './roles.js';
export { newTradeCode, normalizeTradeCode } from './tradeCode.js';
export { MAX_NETWORK_FEE, X2F_FEE_BPS, feeFor, feeSplitLayout, networkFeeShares, wallet2PayOrder } from './fees.js';
export { FEEDBACK_FORM_DAILY } from './feedback.js';
export {
  COMPROMISED_METHODS,
  compromisedTicketLabel,
  type CompromisedMethod,
  TICKET_BODY_MAX,
  TICKET_CATEGORIES,
  TICKET_KEEP_DAYS,
  TICKET_OPEN_AT_ONCE,
  TICKET_OPEN_DAILY,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
} from './tickets.js';

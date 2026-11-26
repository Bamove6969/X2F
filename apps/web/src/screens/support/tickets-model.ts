/**
 * Support tickets on the trader app (Plan 4 Task 31; API: apps/api/src/tickets/traderRoutes.ts):
 * the calls, and the words for categories and statuses. A plain module (no React) so tests and the
 * copy lint read it directly.
 */
import { TICKET_CATEGORIES, TICKET_KEEP_DAYS, type TicketCategory, type TicketStatus } from '@x2f/core';
import { api } from '../../api/client.js';

export { TICKET_BODY_MAX, TICKET_CATEGORIES, TICKET_OPEN_AT_ONCE, TICKET_OPEN_DAILY, type TicketCategory, type TicketStatus } from '@x2f/core';

export interface TicketSummary {
  id: string;
  category: TicketCategory;
  status: TicketStatus;
  tradeCode: string | null;
  createdAt: string;
  updatedAt: string;
  lastFrom: 'trader' | 'staff';
}

export interface TicketMessage {
  from: 'trader' | 'staff';
  /** Team tickets (owner Q69): the team member who wrote a trader line; left out for the account owner's own lines. */
  by?: string;
  body: string;
  at: string;
}

export interface TicketThreadView {
  id: string;
  category: TicketCategory;
  status: TicketStatus;
  tradeCode: string | null;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

/** A ticket id as the API makes them (a lower-case uuid): a row whose id is anything else is dropped, so no link can lead elsewhere. */
export const isTicketId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

export async function listTickets(signal?: AbortSignal): Promise<{ items: TicketSummary[] }> {
  const r = await api<{ items: TicketSummary[] }>('/v1/tickets', signal ? { signal } : {});
  return { items: Array.isArray(r.items) ? r.items.filter((t) => isTicketId(t.id) && (TICKET_CATEGORIES as readonly string[]).includes(t.category)) : [] };
}
export const getTicket = (id: string, signal?: AbortSignal) => api<TicketThreadView>(`/v1/tickets/${encodeURIComponent(id)}`, signal ? { signal } : {});
export const openTicket = (b: { category: TicketCategory; body: string; tradeCode?: string }) => api<{ id: string }>('/v1/tickets', { method: 'POST', body: b });
export const replyTicket = (id: string, body: string) => api<TicketThreadView>(`/v1/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body } });
export const closeTicket = (id: string) => api<TicketThreadView>(`/v1/tickets/${encodeURIComponent(id)}/close`, { method: 'POST', body: {} });

/** The categories in the API's order, "Everything else" last. COPY-UNSIGNED: the owner confirms the list (Task 30). */
export const CATEGORY_LABELS: Readonly<Record<TicketCategory, string>> = {
  account: 'Account and login',
  trades: 'A trade',
  offers: 'Offers',
  wallets: 'Wallets',
  alerts: 'Alerts and notices',
  'everything-else': 'Everything else',
};
export const CATEGORY_ORDER: readonly TicketCategory[] = TICKET_CATEGORIES;

/** COPY-UNSIGNED */
export const STATUS_LABELS: Readonly<Record<TicketStatus, string>> = {
  open: 'Waiting for X2F',
  answered: 'X2F replied',
  closed: 'Closed',
};

/** COPY-UNSIGNED: every sentence the ticket screens say. */
export const TICKET_COPY = {
  listTitle: 'Support tickets',
  newTitle: 'Open a ticket',
  open: 'Open a ticket',
  emptyTitle: 'No tickets yet',
  emptyBody: 'Ask X2F staff anything. Pick what it is about, write it, and follow the answers here.',
  listLead: 'Your questions to X2F staff, newest activity first.',
  categoryLabel: 'What is it about?',
  tradeLabel: 'Trade code (optional)',
  tradeHint: 'If it is about one of your trades, add its code so staff can find it.',
  messageLabel: 'Your message',
  messagePlaceholder: 'Tell us what happened and what you need',
  send: 'Send',
  privacy: `Only you and the X2F staff member working on your ticket can read it. It is kept encrypted and deleted ${TICKET_KEEP_DAYS} days after its last message or after it is closed, whichever is later.`,
  tradeUnknown: 'That code is not one of your trades. Check it, or leave the field empty.',
  badText: 'Your message has a hidden character the form does not take. Retype it, or paste it as plain text.',
  failed: 'That did not send. Try again in a moment.',
  loadFailed: 'X2F could not load your tickets just now. Try again in a moment.',
  threadTitle: 'Ticket',
  // An id that names no ticket of this account (a stale link, or a ticket past its retention).
  missing: 'This ticket is not in your list. It may have been deleted.',
  you: 'You',
  // Team tickets (owner Q69): a line the account owner wrote, read by a team member.
  owner: 'Team owner',
  staff: 'X2F support',
  replyLabel: 'Write a reply',
  close: 'Close ticket',
  closedNote: 'This ticket is closed. Open a new ticket if you need more help.',
  back: 'Back',
  tradeLine: 'Trade',
  opened: 'Opened',
} as const;

/**
 * Who wrote a line, as the reader is shown it: "X2F support" for staff (never a staff name); for a
 * trader line, "You" for the reader's own lines, the member's name for a team member's line (`by`),
 * and "Team owner" for the account owner's line read by a member. `viewer`: the reading member's
 * name, null for the account owner.
 */
export function whoWrote(m: TicketMessage, viewer: string | null): string {
  if (m.from === 'staff') return TICKET_COPY.staff;
  const by = typeof m.by === 'string' && m.by !== '' ? m.by : null;
  if (by === null) return viewer === null ? TICKET_COPY.you : TICKET_COPY.owner;
  return viewer !== null && by === viewer ? TICKET_COPY.you : by;
}

/** The daily cap on new tickets (429 `limit: 'daily'`). COPY-UNSIGNED */
export const TICKETS_DAILY_TEXT = (n: number) => `You've opened ${n} tickets in the last day. The limit helps keep spam out. Try again tomorrow.`;
/** The daily cap on replies (429 `limit: 'daily'`). COPY-UNSIGNED */
export const REPLIES_DAILY_TEXT = "You've sent a lot of replies in the last day. The limit helps keep spam out. Try again tomorrow.";

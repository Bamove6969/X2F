// Seams for the parts of the dispute screens that other tasks build (Plan 3 Task 27). Each default
// below stands in until that task lands; apps/web/test/dispute-tripwires.test.ts fails when it does,
// so the real part gets wired in here and the stand-in deleted.
//
// - Chat (Task 20): DisputeRoom's message list and composer are Task 20's TradeChatPanel (wired
//   2026-10-30), under the server's own system cards (dispute opened, moderator joined) drawn here.
// - Proof pipeline (Plan 5 Tasks 13-15): "Add more evidence" on DisputeOpen and the unblurred-proof
//   request on DisputeRoom. Spec 4.2: metadata is stripped and private details blurred on the device,
//   and the unblurred copy goes to the moderator only. Plan 5 builds that pipeline; until then no
//   file can be picked at all (there is no file input), so nothing unprocessed can ever be sent.
// - Proofs already in the trade (Task 23's proof slot, then Plan 5): the "Zelle screenshot · Already
//   in this trade, blurred" card and the "Your Zelle screenshot" evidence chip. None until then.
import type { ReactNode } from 'react';
import type { DisputeTrade, DisputeView } from './api.js';
import { clockTime, reasonLabel } from './rules.js';

/** What a chat slot is given: the system cards come from server records only. */
export interface ChatSlotProps {
  trade: DisputeTrade;
  dispute: DisputeView;
  systemCards: { at: string; text: string }[];
}

/** The server's own system cards of the dispute, above the chat (from server records only). */
export function DisputeSystemCards({ systemCards }: ChatSlotProps): ReactNode {
  return (
    <div role="log" aria-label="Dispute events" className="dispute-log">
      {systemCards.map((c) => (
        <div key={`${c.at}${c.text}`} className="dispute-system-card">
          {clockTime(new Date(c.at))} · {c.text}
        </div>
      ))}
    </div>
  );
}

/** The server-recorded events of the dispute, as the board's system cards, for this side. */
export function systemCardsFor(trade: DisputeTrade, d: DisputeView): { at: string; text: string }[] {
  const cards: { at: string; text: string }[] = [];
  cards.push({
    at: d.openedAt,
    // The board's line for the opener; the other side sees who opened it (COPY-UNSIGNED).
    text:
      d.openedBy === 'system' || d.reason === 'escalated'
        ? 'This trade went to a moderator automatically.' // COPY-UNSIGNED
        : d.openedBy === trade.role
          ? `You opened a dispute: ${reasonLabel(d.openedBy, d.reason)}`
          : `${trade.counterparty} opened a dispute`,
  });
  if (d.moderator !== null) cards.push({ at: d.moderator.joinedAt, text: `Moderator ${d.moderator.name} joined this dispute` });
  return cards;
}

/** A proof already attached to this trade, as DisputeOpen and DisputeRoom list it. */
export interface TradeProof {
  /** "Zelle screenshot" */
  label: string;
}

/** NEEDS_TASK_23 / NEEDS_PLAN_5: the proofs already in this trade. None until the proof slot exists. */
export function tradeProofs(_trade: DisputeTrade): TradeProof[] {
  return [];
}

/**
 * NEEDS_PLAN_5: "Add more evidence" goes through Plan 5's on-device pipeline (strip metadata,
 * blur, the trader checks the blur, then encrypt). Until it exists the row is shown disabled and
 * has no file input.
 */
export function EvidenceUpload(): ReactNode {
  return (
    <div className="dispute-add-evidence" aria-disabled="true">
      <UploadIcon />
      <span className="dispute-stack">
        <span className="dispute-strong">Add more evidence</span>
        <span className="dispute-muted-sm">
          Bank statement, receipt or messages. Private details are blurred for you to check. Location and device info are removed.
        </span>
      </span>
    </div>
  );
}

/** NEEDS_PLAN_5 (Task 15 SendUnblurred) with Plan 4's proof request record: nothing until both exist. */
export function UnblurredRequest(_p: { trade: DisputeTrade; dispute: DisputeView }): ReactNode {
  return null;
}

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
    </svg>
  );
}

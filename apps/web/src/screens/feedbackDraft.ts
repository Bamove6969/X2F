/**
 * The feedback form's draft (Plan 5 Task 21, review M6): kept in this tab's sessionStorage so it
 * survives the log-in round trip, and nothing longer (round-2 review N-M6). It is dropped when the
 * form is sent, on every log-out (`logOut` in push/usePush.ts), and when a different account than
 * the one that wrote it is signed in. A draft written while signed out belongs to whoever logs in
 * next in this tab: that is the round trip it exists for. A plain module (no React, no CSS).
 */
export type FeedbackKind = 'complaint' | 'feedback' | 'recommendation';

export interface FeedbackDraft {
  kind: FeedbackKind;
  text: string;
  anonymous: boolean;
  /** The public name of the account that wrote it; null when written signed out. */
  owner: string | null;
}

const DRAFT_KEY = 'x2f.feedback-draft';
const KINDS: readonly FeedbackKind[] = ['complaint', 'feedback', 'recommendation'];
const MAX = 4000;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The kept draft, or null. With `owner` set, a draft another account wrote reads as none. */
export function loadFeedbackDraft(owner: string | null): FeedbackDraft | null {
  try {
    const raw = storage()?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<FeedbackDraft>;
    if (!KINDS.includes(d.kind as FeedbackKind) || typeof d.text !== 'string' || typeof d.anonymous !== 'boolean') return null;
    const by = typeof d.owner === 'string' ? d.owner : null;
    if (owner !== null && by !== null && by !== owner) return null;
    return { kind: d.kind as FeedbackKind, text: d.text.slice(0, MAX), anonymous: d.anonymous, owner: by };
  } catch {
    return null;
  }
}

export function saveFeedbackDraft(d: FeedbackDraft): void {
  try {
    if (d.text === '') storage()?.removeItem(DRAFT_KEY);
    else storage()?.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // Storage can be off (private mode); the form still works without a draft.
  }
}

export function clearFeedbackDraft(): void {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    // As saveFeedbackDraft.
  }
}

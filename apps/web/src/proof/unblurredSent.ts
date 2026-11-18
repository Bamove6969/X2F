// Review I2 (wip/lead-proof-upload, 18 Nov 2026): what this tab knows about the unblurred copy's key
// reaching the moderator. The dispute view's `proofRequest.sentAt` only says the ciphertext is
// stored (the PUT), not that its key was posted, so "Sent to <mod>", the system card and the
// evidence chip are shown only once this tab saw the post succeed or the chat holds this side's own
// moderator-only receipt (ChatSnapshot.modOnlySentAt) from after the request. Kept per request
// (trade code and request time), in memory only, and forgotten with the session (forgetLocalSession).
// A kept post holds the payload (the key and the picture's facts, never its pixels) in a closure.

const posted = new Map<string, Date>();
const kept = new Map<string, () => Promise<unknown>>();
/** The chat's answer to "is this side's copy there?": true or false once asked. */
const receipts = new Map<string, boolean>();
const asking = new Map<string, symbol>();
const listeners = new Set<() => void>();
let version = 0;

const emit = (): void => {
  version++;
  for (const l of listeners) l();
};

export const unblurredKey = (code: string, requestAt: string): string => `${code} ${requestAt}`;

export function subscribeUnblurred(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const unblurredVersion = (): number => version;

/** The key's post succeeded in this tab. */
export function markUnblurredPosted(key: string, at: Date): void {
  posted.set(key, at);
  kept.delete(key);
  emit();
}
export const unblurredPostedAt = (key: string): Date | undefined => posted.get(key);

/** The copy is stored but its key's post failed: `retry` posts it again (UnblurredPostFailed.retry). */
export function keepUnblurredPost(key: string, retry: () => Promise<unknown>): void {
  kept.set(key, retry);
  emit();
}
export const keptUnblurredPost = (key: string): (() => Promise<unknown>) | undefined => kept.get(key);

export const unblurredReceipt = (key: string): boolean | undefined => receipts.get(key);

/**
 * Asks the chat once (concurrent callers share the question) whether it holds this side's copy from
 * at or after `requestAt`. A failed question stores nothing, so the next caller asks again.
 */
export function askUnblurredReceipt(key: string, requestAt: string, times: () => Promise<string[]>): void {
  if (asking.has(key) || receipts.has(key)) return;
  const mine = Symbol(key);
  asking.set(key, mine);
  const from = Date.parse(requestAt);
  // An answer that lands after the session was forgotten (or another question began) is dropped.
  const current = (): boolean => asking.get(key) === mine;
  void times()
    .then((ts) => {
      if (!current()) return;
      receipts.set(key, ts.some((t) => Date.parse(t) >= from));
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      if (current()) asking.delete(key);
    });
}

/** The session ended: none of it outlives the account in this tab. */
export function forgetUnblurredSends(): void {
  posted.clear();
  kept.clear();
  receipts.clear();
  asking.clear();
  emit();
}

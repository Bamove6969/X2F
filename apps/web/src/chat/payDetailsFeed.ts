/**
 * The seller's payment details for the buyer's "Send exactly" card (J-08, S-090), read from the
 * trade's encrypted chat: the newest package (a line with `pay`) the seller sent, as labelled rows.
 * This closes paySeams.ts's GAP ("no API carries them"): none does, and none needs to. The
 * details travel only as ciphertext inside chat envelopes, and are decrypted in the escrow worker
 * like every line (chat/engine.ts); this module only reads the worker's verified snapshot.
 *
 * `chatPaymentDetailsSource` is the `PaymentDetailsSource` App.tsx installs (setPaymentDetailsSource).
 * It syncs the chat itself, through the same worker engine the panel uses, so the card fills even
 * while the phone's chat sheet is closed: on subscribe, on the chat's live event and on a timer.
 * An open ChatPanel for the same trade also hands in each snapshot it gets (`publishPaySnapshot`),
 * so the card follows the panel at once; while such a panel is open (`panelPublishing`) the feed's
 * own timer pauses, so the chat is polled once per interval, not twice (pay-details review M5).
 */
import { payFieldsFor } from '@x2f/trade';
import type { PaymentDetail, PaymentDetailsSource } from '../screens/trade/paySeams.js';
import { chatClient, openTradeChat, type ChatSnapshot } from './client.js';
import { onChatLive } from './live.js';

/** How often the feed re-syncs with no live event (the panel's ready poll). */
export const PAY_FEED_POLL_MS = 15_000;

/**
 * The rows of the newest package from the seller (the payee), or null when there is none. The
 * buyer's own packages and plain lines never count; the labels are the method table's, so the
 * card and the chat's card always say the same.
 */
export function payRowsOf(snap: ChatSnapshot): PaymentDetail[] | null {
  let newest: ChatSnapshot['lines'][number] | null = null;
  for (const l of snap.lines) {
    if (l.from !== 'seller' || l.pay === undefined || l.missing) continue;
    if (newest === null || BigInt(l.id) > BigInt(newest.id)) newest = l;
  }
  if (newest === null || newest.pay === undefined) return null;
  const spec = payFieldsFor(newest.pay.method);
  return newest.pay.fields.map((f) => ({ label: spec.find((s) => s.key === f.key)?.label ?? f.key, value: f.value }));
}

const norm = (c: string): string => c.replace(/-/g, '').toUpperCase();
const listeners = new Map<string, Set<(d: PaymentDetail[] | null) => void>>();
const latest = new Map<string, PaymentDetail[] | null>();
/** How many open panels are publishing for each trade. */
const panels = new Map<string, number>();

/**
 * An open ChatPanel for `tradeCode` is syncing its chat and publishing every snapshot: the feed's
 * own poll for that trade pauses until the returned release is called (the panel's unmount).
 */
export function panelPublishing(tradeCode: string): () => void {
  const key = norm(tradeCode);
  panels.set(key, (panels.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (panels.get(key) ?? 1) - 1;
    if (n <= 0) panels.delete(key);
    else panels.set(key, n);
  };
}

/** An open panel's snapshot for `tradeCode`: the card follows it at once. */
export function publishPaySnapshot(tradeCode: string, snap: ChatSnapshot): void {
  const key = norm(tradeCode);
  const rows = payRowsOf(snap);
  latest.set(key, rows);
  for (const cb of [...(listeners.get(key) ?? [])]) cb(rows);
}

/** The `PaymentDetailsSource` for the trade room: the seller's newest package in the trade's chat. */
export const chatPaymentDetailsSource: PaymentDetailsSource = (code, onDetails) => {
  const key = norm(code);
  let live = true;
  const set = listeners.get(key) ?? new Set();
  listeners.set(key, set);
  set.add(onDetails);
  onDetails(latest.get(key) ?? null);

  let chat: string | null = null;
  const sync = async (): Promise<void> => {
    if (!live || chat === null) return;
    try {
      const snap = await chatClient().sync(chat);
      if (live) publishPaySnapshot(code, snap);
    } catch {
      // A failed sync keeps the last rows (or null, which the card shows as "Ask in the chat").
    }
  };
  let offLive: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  void openTradeChat(code)
    .then((c) => {
      if (!live) return;
      chat = c;
      offLive = onChatLive(c, () => void sync());
      // Paused while a panel for this trade polls the same chat and publishes (review M5).
      timer = setInterval(() => {
        if (!panels.has(key)) void sync();
      }, PAY_FEED_POLL_MS);
      return sync();
    })
    .catch(() => {
      // No chat for this trade (or none yet): the card stays at null, never a guess.
    });

  return () => {
    live = false;
    set.delete(onDetails);
    // The last card for this trade gone: forget the rows (they are read from the chat again next time).
    if (set.size === 0) {
      listeners.delete(key);
      latest.delete(key);
    }
    offLive?.();
    if (timer !== null) clearInterval(timer);
  };
};

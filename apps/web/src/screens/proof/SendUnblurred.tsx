import type { ProofUnblurredPayload } from '@x2f/proof';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { chatClient, openTradeChat } from '../../chat/client.js';
import { browserProofImageDeps } from '../../proof/browserImage.js';
import { type UnblurredPicture, UnblurredPostFailed, prepareUnblurred, putProof, sendUnblurred } from '../../proof/upload.js';
import {
  askUnblurredReceipt,
  keepUnblurredPost,
  keptUnblurredPost,
  markUnblurredPosted,
  subscribeUnblurred,
  unblurredKey,
  unblurredPostedAt,
  unblurredReceipt,
  unblurredVersion,
} from '../../proof/unblurredSent.js';
import { clockTime } from '../dispute/rules.js';
import { Notice } from '../../ui/Notice.js';
import { proofSendNotice, type ProofSendNotice } from './AddProof.js';
import './proof.css';

// Plan 5 Task 15: DisputeRoom board, "Request from the moderator" (the board's lines where it has
// them; anything else COPY-UNSIGNED). Review Focus 4: X2F keeps no original on the device (no
// `localOriginals`: owner question), so the trader always picks the screenshot again. It is stripped
// (re-encoded from pixels, cleaned), never blurred, and its key is sealed to the moderator only.

/**
 * The board's line, with the moderator's name for the board's "she" (X2F does not know anyone's
 * gender). COPY-UNSIGNED: "Only <mod> will see it." in place of "Only she will see it."
 */
export function unblurredAsk(mod: string, counterparty: string): string {
  return `${mod} asked you for the unblurred proof. Only ${mod} will see it. ${counterparty} won't.`;
}
// COPY-UNSIGNED: Review Focus 4, the copy is not kept on this device.
export const UNBLURRED_PICK_AGAIN = 'Pick the same screenshot again. Location and device info are removed. Nothing is blurred.';
// COPY-UNSIGNED
export const UNBLURRED_PREPARING = 'Getting your copy ready…';
/** The board's system line (DisputeRoom "10:58 · You sent an unblurred proof to the moderator only"). */
export const UNBLURRED_SENT_CARD = 'You sent an unblurred proof to the moderator only';
/** COPY-UNSIGNED (review I2): the copy is stored, its key's post failed; Try again posts it only. */
export function unblurredKept(mod: string): string {
  return `Your copy is uploaded but not sent to ${mod} yet. Check your connection and try again.`;
}
// COPY-UNSIGNED (review I2)
export const UNBLURRED_TRY_AGAIN = 'Try again';
/**
 * COPY-UNSIGNED (review I2, owner question): the server holds this side's copy (`sentAt`) but the
 * chat has no sign its key was posted, and this tab no longer holds it (a reload). The API takes one
 * copy per request, so another upload would be refused.
 */
export function unblurredLost(mod: string): string {
  return `Your copy is on X2F, but ${mod} has no way to open it yet. Tell ${mod} in the chat.`;
}

export interface UnblurredRequestView {
  username: string;
  at: string;
  sentAt: string | null;
}

/** The real send: the ciphertext up as kind=unblurred (Task 14), its key sealed to the moderator in the trade's chat. */
export function sendTradeUnblurred(a: { code: string; picture: UnblurredPicture }): Promise<{ proofId: string }> {
  return sendUnblurred(a, {
    encode: browserProofImageDeps().encode,
    put: (code, proofId, kind, ciphertext) => putProof(code, proofId, kind, ciphertext),
    postUnblurred: async (code: string, payload: ProofUnblurredPayload) => {
      await chatClient().sendUnblurred(await openTradeChat(code), payload);
    },
  });
}

/** This side's own moderator-only receipts in the trade's chat (ChatSnapshot.modOnlySentAt). */
export async function chatUnblurredReceipts(code: string): Promise<string[]> {
  return (await chatClient().sync(await openTradeChat(code))).modOnlySentAt ?? [];
}

/**
 * Review I2: whether this request's copy reached the moderator. `sent` only once this tab saw the
 * key's post succeed or the chat holds this side's moderator-only receipt from after the request;
 * the server's `sentAt` alone (the ciphertext is stored) is `checking`, then `lost` if the chat has
 * none. `kept`: the post failed after the upload, and this tab still holds it to try again.
 */
export type UnblurredStatus = { s: 'none' } | { s: 'checking' } | { s: 'kept' } | { s: 'lost' } | { s: 'sent'; at: Date };

export function useUnblurredStatus(code: string, request: UnblurredRequestView | null, receipts: (code: string) => Promise<string[]> = chatUnblurredReceipts): UnblurredStatus {
  const v = useSyncExternalStore(subscribeUnblurred, unblurredVersion);
  const key = request === null ? null : unblurredKey(code, request.at);
  const sentAt = request?.sentAt ?? null;
  const requestAt = request?.at ?? null;
  const ask = useRef(receipts);
  ask.current = receipts;
  useEffect(() => {
    if (key === null || sentAt === null || requestAt === null) return;
    if (unblurredPostedAt(key) !== undefined || keptUnblurredPost(key) !== undefined) return;
    askUnblurredReceipt(key, requestAt, () => ask.current(code));
  }, [key, sentAt, requestAt, code, v]);
  if (key === null) return { s: 'none' };
  const postedAt = unblurredPostedAt(key);
  if (postedAt !== undefined) return { s: 'sent', at: sentAt !== null ? new Date(sentAt) : postedAt };
  if (keptUnblurredPost(key) !== undefined) return { s: 'kept' };
  if (sentAt === null) return { s: 'none' };
  const found = unblurredReceipt(key);
  if (found === undefined) return { s: 'checking' };
  return found ? { s: 'sent', at: new Date(sentAt) } : { s: 'lost' };
}

type Step = { s: 'ask'; notice: ProofSendNotice | null } | { s: 'busy' };

export function SendUnblurred({
  code,
  request,
  counterparty,
  prepare = (file: File) => prepareUnblurred(file, browserProofImageDeps()),
  send = sendTradeUnblurred,
  onSent,
  now = () => new Date(),
  receipts = chatUnblurredReceipts,
}: {
  code: string;
  request: UnblurredRequestView;
  counterparty: string;
  prepare?: (file: File) => Promise<UnblurredPicture>;
  send?: (a: { code: string; picture: UnblurredPicture }) => Promise<unknown>;
  onSent?: () => void;
  /** The time shown right after a send, until the dispute view brings the server's `sentAt`. */
  now?: () => Date;
  /** This side's moderator-only receipts in the trade's chat (review I2: "Sent" needs one, or a post seen here). */
  receipts?: (code: string) => Promise<string[]>;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ s: 'ask', notice: null });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const mod = request.username;
  const key = unblurredKey(code, request.at);
  const status = useUnblurredStatus(code, request, receipts);

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setStep({ s: 'busy' });
    let picture: UnblurredPicture;
    try {
      picture = await prepare(file);
    } catch (e) {
      if (alive.current) setStep({ s: 'ask', notice: proofSendNotice(e) });
      return;
    }
    if (!alive.current) {
      picture.rgba.fill(0);
      return;
    }
    try {
      // sendUnblurred zeroes the pixels whatever happens; a failed upload asks for the file again.
      await send({ code, picture });
    } catch (e) {
      picture.rgba.fill(0);
      // Review I2: stored, but the key's post failed after its tries: keep it (past this card) to post again.
      if (e instanceof UnblurredPostFailed) keepUnblurredPost(key, e.retry);
      if (alive.current) setStep({ s: 'ask', notice: e instanceof UnblurredPostFailed ? null : proofSendNotice(e) });
      return;
    }
    markUnblurredPosted(key, now());
    onSent?.();
    if (alive.current) setStep({ s: 'ask', notice: null });
  };

  /** Review I2: posts the kept payload again, and nothing else (the copy is never sent up twice). */
  const tryAgain = async () => {
    const retry = keptUnblurredPost(key);
    if (retry === undefined) return;
    setStep({ s: 'busy' });
    try {
      await retry();
    } catch (e) {
      if (e instanceof UnblurredPostFailed) keepUnblurredPost(key, e.retry);
      if (alive.current) setStep({ s: 'ask', notice: null });
      return;
    }
    markUnblurredPosted(key, now());
    onSent?.();
    if (alive.current) setStep({ s: 'ask', notice: null });
  };

  return (
    <section aria-label="Request from the moderator" className="x2f-stack x2f-unblurred" data-part="send-unblurred">
      <p className="x2f-unblurred__ask">{unblurredAsk(mod, counterparty)}</p>
      {status.s === 'sent' ? (
        <p className="x2f-unblurred__sent" role="status" data-part="unblurred-sent">
          {/* COPY-UNSIGNED */}
          Sent to {mod} at {clockTime(status.at)}
        </p>
      ) : status.s === 'kept' ? (
        <>
          <Notice tone="caution" live="alert" data-part="unblurred-kept">
            {unblurredKept(mod)}
          </Notice>
          <button type="button" className="x2f-button x2f-button--primary" data-primary="" disabled={step.s === 'busy'} onClick={() => void tryAgain()}>
            {UNBLURRED_TRY_AGAIN}
          </button>
        </>
      ) : status.s === 'lost' ? (
        <Notice tone="caution" live="status" data-part="unblurred-lost">
          {unblurredLost(mod)}
        </Notice>
      ) : status.s === 'checking' ? null : (
        <>
          {step.s === 'ask' && step.notice ? (
            <Notice tone="caution" live="alert" data-part={step.notice.part}>
              {step.notice.text}
            </Notice>
          ) : null}
          {step.s === 'busy' ? (
            <p className="x2f-note" role="status">
              {UNBLURRED_PREPARING}
            </p>
          ) : null}
          <p className="x2f-note">{UNBLURRED_PICK_AGAIN}</p>
          <label htmlFor={inputId} className="x2f-button x2f-button--primary" data-primary="" aria-disabled={step.s === 'busy' ? 'true' : undefined}>
            {/* COPY-UNSIGNED */}
            Send unblurred proof to {mod}
            <input
              ref={input}
              id={inputId}
              type="file"
              accept="image/*"
              disabled={step.s === 'busy'}
              className="x2f-visually-hidden"
              onChange={(e) => void pick(e.currentTarget.files?.[0])}
            />
          </label>
        </>
      )}
    </section>
  );
}

import type { ProofUnblurredPayload } from '@x2f/proof';
import { useEffect, useId, useRef, useState } from 'react';
import { chatClient, openTradeChat } from '../../chat/client.js';
import { browserProofImageDeps } from '../../proof/browserImage.js';
import { type UnblurredPicture, prepareUnblurred, putProof, sendUnblurred } from '../../proof/upload.js';
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

type Step = { s: 'ask'; notice: ProofSendNotice | null } | { s: 'busy' } | { s: 'sent'; at: Date };

export function SendUnblurred({
  code,
  request,
  counterparty,
  prepare = (file: File) => prepareUnblurred(file, browserProofImageDeps()),
  send = sendTradeUnblurred,
  onSent,
  now = () => new Date(),
}: {
  code: string;
  request: UnblurredRequestView;
  counterparty: string;
  prepare?: (file: File) => Promise<UnblurredPicture>;
  send?: (a: { code: string; picture: UnblurredPicture }) => Promise<unknown>;
  onSent?: () => void;
  /** The time shown right after a send, until the dispute view brings the server's `sentAt`. */
  now?: () => Date;
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
      // sendUnblurred zeroes the pixels whatever happens; a failure asks for the file again.
      await send({ code, picture });
    } catch (e) {
      picture.rgba.fill(0);
      if (alive.current) setStep({ s: 'ask', notice: proofSendNotice(e) });
      return;
    }
    onSent?.();
    if (alive.current) setStep({ s: 'sent', at: now() });
  };

  const sentAt = request.sentAt !== null ? new Date(request.sentAt) : step.s === 'sent' ? step.at : null;
  return (
    <section aria-label="Request from the moderator" className="x2f-stack x2f-unblurred" data-part="send-unblurred">
      <p className="x2f-unblurred__ask">{unblurredAsk(mod, counterparty)}</p>
      {sentAt !== null ? (
        <p className="x2f-unblurred__sent" role="status" data-part="unblurred-sent">
          Sent to {mod} at {clockTime(sentAt)}
        </p>
      ) : (
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

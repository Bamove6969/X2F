import type { ProofExpected } from '@x2f/proof';
import { useEffect, useId, useRef, useState } from 'react';
import { ChatFailed, chatClient, openTradeChat } from '../../chat/client.js';
import { browserProofImageDeps } from '../../proof/browserImage.js';
import { hiddenByUploader, proofCodeNotice } from '../../proof/uploaderChecks.js';
import { proofPosted } from '../../api/blurCheck.js';
import {
  type BlurKind,
  type EditorRegion,
  type PreparedProof,
  type ProofSendDeps,
  PROOF_CANT_USE,
  ProofInputError,
  prepareProof,
  putProof,
  sendProof,
} from '../../proof/upload.js';
import { Button } from '../../ui/Button.js';
import { Notice } from '../../ui/Notice.js';
import { BlurEditor } from './BlurEditor.js';

// DESIGNER-REVIEW: the states around the editor (no board). COPY-UNSIGNED unless the board's.
// COPY-UNSIGNED
export const PROOF_SENT = 'Proof sent. The seller can see it in the chat.';
// COPY-UNSIGNED
export const PROOF_SEND_FAILED = "Couldn't send your proof. Check your connection and try again.";
// COPY-UNSIGNED: a placeholder line for design to word (review M2, owner question). The send got no
// answer after the envelope went to the API, so the proof may be with the seller already.
export const PROOF_SEND_UNCERTAIN = 'Your proof may have been sent. Check the chat before you send it again.';
// COPY-UNSIGNED
export const PROOF_PREPARING = 'Getting your proof ready…';

export interface SendArgs {
  code: string;
  prepared: PreparedProof;
  regions: EditorRegion[];
  /** Item 64's explanation; TODO(owner p11-141): it goes nowhere yet. */
  explanation: string | null;
  /** Whether the buyer's own blur covers the amount or the memo (the proof-code notice's input). */
  ownHidden: { amount: boolean; memo: boolean };
}

/** The real send: the ciphertext up, the key in the trade's chat. */
/**
 * The real send's parts: the ciphertext up (Task 14), its key in the trade's chat, then the blur
 * check's announcement (proof stack: wip/lead-proof-check's `proofPosted`, the proof id and the blur
 * kind only; a failure there never fails the send, upload.ts).
 */
export function tradeProofDeps(): ProofSendDeps {
  return {
    encode: browserProofImageDeps().encode,
    put: (code, proofId, kind, ciphertext) => putProof(code, proofId, kind, ciphertext),
    postAttached: async (code, payload) => {
      await chatClient().sendProof(await openTradeChat(code), payload);
    },
    onPosted: async (code, proofId, blur) => {
      await proofPosted(code, proofId, blur);
    },
  };
}

/**
 * P-020 with the proof (proof stack: wip/lead-proof-code's `proofCodeNotice`): when the poster's own
 * blur covers the memo with the trade code, the fixed notice goes into the trade's chat. Nothing
 * when it does not.
 */
export async function sendCodeNotice(code: string, ownHidden: { amount: boolean; memo: boolean }): Promise<void> {
  const notice = proofCodeNotice(ownHidden);
  if (notice === null) return;
  await chatClient().sendNotice(await openTradeChat(code), notice);
}

export async function sendTradeProof(a: SendArgs): Promise<{ proofId: string; blur: BlurKind }> {
  const r = await sendProof({ code: a.code, prepared: a.prepared, regions: a.regions }, tradeProofDeps());
  try {
    await sendCodeNotice(a.code, a.ownHidden);
  } catch {
    // The proof is sent; the notice is a courtesy line (the seller's card checks the memo itself).
  }
  return r;
}

/** What a send that did not go through says: not sent, maybe sent (review M2), or an unusable image (M5). */
type SendNotice = { part: 'proof-send-error' | 'proof-send-uncertain' | 'proof-send-cant-use'; text: string };

function noticeOf(e: unknown): SendNotice {
  if (e instanceof ChatFailed && e.code === 'uncertain') return { part: 'proof-send-uncertain', text: PROOF_SEND_UNCERTAIN };
  // Too large even as JPEG (finishProof): another try fails the same way, so it is not the connection.
  if (e instanceof ProofInputError) return { part: 'proof-send-cant-use', text: PROOF_CANT_USE };
  return { part: 'proof-send-error', text: PROOF_SEND_FAILED };
}

type Step = { s: 'pick'; error: string | null } | { s: 'preparing' } | { s: 'edit'; prepared: PreparedProof; busy: boolean; notice: SendNotice | null } | { s: 'sent' };

/** Review M1: zero the unblurred pixels and drop the OCR words (their strings cannot be zeroed). */
const drop = (p: PreparedProof): void => {
  p.rgba.fill(0);
  p.words.length = 0;
};

/**
 * BuyerPay's "Add payment proof": pick a picture, check the blur, send. The picked file is read on
 * this device only; its name is never shown or sent. The decoded pixels are zeroed (`drop`) on
 * every way out (review M1): after the send, on Choose another, and when this screen goes while it
 * holds them (leaving the trade room, the chat opening, the layout crossing its breakpoint, which
 * remounts the slot and loses the edits): at once, or when a send in flight settles. A decode that
 * finishes after the screen went is zeroed as it arrives. A failed send keeps them for the retry.
 * The picked file's bytes are zeroed in prepareProof, and the decode canvas in browserImage.ts.
 */
export function AddProof({
  code,
  expected,
  prepare = (file: File) => prepareProof(file, { tradeCode: expected.tradeCode, fiatCents: expected.fiatCents, exponent: expected.exponent }, browserProofImageDeps()),
  send = sendTradeProof,
  onSent,
}: {
  code: string;
  expected: ProofExpected;
  prepare?: (file: File) => Promise<PreparedProof>;
  send?: (a: SendArgs) => Promise<unknown>;
  onSent?: () => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ s: 'pick', error: null });
  /** The prepared proof this screen holds, whatever step it shows; `sending` while a send is in flight. */
  const held = useRef<PreparedProof | null>(null);
  const sending = useRef(false);
  const alive = useRef(true);
  const release = () => {
    if (held.current !== null) drop(held.current);
    held.current = null;
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // A send in flight still reads them; it zeroes them when it settles.
      if (!sending.current) release();
    };
  }, []);

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setStep({ s: 'preparing' });
    let p: PreparedProof;
    try {
      p = await prepare(file);
    } catch {
      // Any refusal reads the same (Review Focus 2: ProofInputError's code is not shown); nothing is logged.
      if (alive.current) setStep({ s: 'pick', error: PROOF_CANT_USE });
      return;
    }
    if (!alive.current) {
      drop(p);
      return;
    }
    held.current = p;
    setStep({ s: 'edit', prepared: p, busy: false, notice: null });
  };

  if (step.s === 'sent') {
    return (
      <Notice tone="plain" live="status" data-part="proof-sent">
        {PROOF_SENT}
      </Notice>
    );
  }

  if (step.s === 'edit') {
    const { prepared } = step;
    return (
      <>
        {step.notice ? (
          <Notice tone="caution" live="alert" data-part={step.notice.part}>
            {step.notice.text}
          </Notice>
        ) : null}
        <BlurEditor
          prepared={prepared}
          expected={expected}
          busy={step.busy}
          onChooseAnother={() => {
            release();
            setStep({ s: 'pick', error: null });
          }}
          onSend={(regions, explanation) => {
            setStep({ s: 'edit', prepared, busy: true, notice: null });
            const ownHidden = hiddenByUploader(regions.filter((r) => r.source === 'manual'), prepared.amount, prepared.memo);
            sending.current = true;
            send({ code, prepared, regions, explanation, ownHidden }).then(
              () => {
                sending.current = false;
                release();
                onSent?.();
                if (alive.current) setStep({ s: 'sent' });
              },
              (e: unknown) => {
                sending.current = false;
                if (!alive.current) release();
                else setStep({ s: 'edit', prepared, busy: false, notice: noticeOf(e) });
              },
            );
          }}
        />
      </>
    );
  }

  return (
    <div className="x2f-stack" data-part="add-proof">
      {step.s === 'pick' && step.error ? (
        <Notice tone="caution" live="alert" data-part="proof-cant-use">
          {step.error}
        </Notice>
      ) : null}
      {step.s === 'preparing' ? (
        <p className="x2f-note" role="status">
          {PROOF_PREPARING}
        </p>
      ) : null}
      <label htmlFor={inputId} className="x2f-proof__slot">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
        </svg>
        <span className="x2f-proof__text">
          <span className="x2f-proof__title">Add payment proof</span>
          <span className="x2f-proof__hint">Private details are blurred for you to check next. Location and device info are removed.</span>
        </span>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept="image/*"
          disabled={step.s === 'preparing'}
          className="x2f-visually-hidden"
          onChange={(e) => void pick(e.currentTarget.files?.[0])}
        />
      </label>
      {step.s === 'pick' && step.error ? (
        <Button variant="quiet" onClick={() => input.current?.click()}>
          Choose another
        </Button>
      ) : null}
    </div>
  );
}

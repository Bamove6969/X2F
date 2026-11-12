import type { ProofExpected } from '@x2f/proof';
import { useId, useRef, useState } from 'react';
import { chatClient, openTradeChat } from '../../chat/client.js';
import { browserProofImageDeps } from '../../proof/browserImage.js';
import { hiddenByUploader } from '../../proof/uploaderChecks.js';
import {
  type BlurKind,
  type EditorRegion,
  type PreparedProof,
  PROOF_CANT_USE,
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
export async function sendTradeProof(a: SendArgs): Promise<{ proofId: string; blur: BlurKind }> {
  const r = await sendProof(
    { code: a.code, prepared: a.prepared, regions: a.regions },
    {
      encode: browserProofImageDeps().encode,
      put: (code, proofId, kind, ciphertext) => putProof(code, proofId, kind, ciphertext),
      postAttached: async (code, payload) => {
        await chatClient().sendProof(await openTradeChat(code), payload);
      },
      // NEEDS_BRANCH_PROOF_CHECK: wip/lead-proof-check's `proofPosted(code, proofId, blur)` goes here.
    },
  );
  // NEEDS_BRANCH_PROOF_CODE: wip/lead-proof-code's `proofCodeNotice(a.ownHidden)` is sent here,
  // through its `chatClient().sendNotice`, when it is not null.
  return r;
}

type Step = { s: 'pick'; error: string | null } | { s: 'preparing' } | { s: 'edit'; prepared: PreparedProof; busy: boolean; error: string | null } | { s: 'sent' };

/**
 * BuyerPay's "Add payment proof": pick a picture, check the blur, send. The picked file is read on
 * this device only; its name is never shown or sent. Once sent or dropped, the decoded pixels are
 * zeroed.
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

  const drop = (p: PreparedProof) => p.rgba.fill(0);

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setStep({ s: 'preparing' });
    try {
      setStep({ s: 'edit', prepared: await prepare(file), busy: false, error: null });
    } catch {
      // Any refusal reads the same (Review Focus 2: ProofInputError's code is not shown); nothing is logged.
      setStep({ s: 'pick', error: PROOF_CANT_USE });
    }
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
        {step.error ? (
          <Notice tone="caution" live="alert" data-part="proof-send-error">
            {step.error}
          </Notice>
        ) : null}
        <BlurEditor
          prepared={prepared}
          expected={expected}
          busy={step.busy}
          onChooseAnother={() => {
            drop(prepared);
            setStep({ s: 'pick', error: null });
          }}
          onSend={(regions, explanation) => {
            setStep({ s: 'edit', prepared, busy: true, error: null });
            const ownHidden = hiddenByUploader(regions.filter((r) => r.source === 'manual'), prepared.amount, prepared.memo);
            send({ code, prepared, regions, explanation, ownHidden }).then(
              () => {
                drop(prepared);
                setStep({ s: 'sent' });
                onSent?.();
              },
              () => setStep({ s: 'edit', prepared, busy: false, error: PROOF_SEND_FAILED }),
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

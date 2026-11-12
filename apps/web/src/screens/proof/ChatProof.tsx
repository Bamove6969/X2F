import { type ProofAttachedPayload, type ReceiveDeps, decryptProof, proofKeyFromBase64 } from '@x2f/proof';
import { useEffect, useState } from 'react';
import { Notice } from '../../ui/Notice.js';
import { PROOF_CHECKING, PROOF_REFUSED_BODY, PROOF_REFUSED_TITLE, ProofThumb } from './ProofThumb.js';

// NEEDS_PROOF_RECEIVE, the page half (Plan 5 Task 15): a chat's `proof.attached` line (opened and
// checked in the escrow worker, chat/chatCrypto.ts) becomes the picture's plaintext here: the
// ciphertext from the API (Task 14, `GET /v1/trades/:code/proofs/:id`), decrypted with the key the
// envelope sealed, bound to this trade, proof id and kind, its SHA-256 checked (decryptProof). The
// plaintext goes only to ProofThumb, which runs the receive check. Nothing logs, keeps or shows
// the key or the bytes.

// DESIGNER-REVIEW: the proof card in the chat (no board yet; Plan 5 Task 15's ProofThumb card).
// COPY-UNSIGNED
// not-a-refusal: a note in place of a proof the server no longer keeps (its retention), not a rule
export const CHAT_PROOF_GONE = 'This proof is no longer stored.';
// COPY-UNSIGNED
export const CHAT_PROOF_TITLE = { proof: 'Payment proof', evidence: 'Dispute evidence' } as const;

/** The server has no such proof (purged after its retention, or never stored). */
class ProofGone extends Error {
  constructor() {
    super('proof-gone');
    this.name = 'ProofGone';
  }
}

/** Fetches and decrypts one proof. Rejects with ProofGone for a 404, anything else for a bad one. */
async function openChatProof(code: string, p: ProofAttachedPayload, f: typeof fetch = globalThis.fetch): Promise<Uint8Array> {
  const res = await f(`/v1/trades/${encodeURIComponent(code)}/proofs/${encodeURIComponent(p.proofId)}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/octet-stream' },
  });
  if (res.status === 404) throw new ProofGone();
  if (!res.ok) throw new Error('proof-unavailable');
  const ciphertext = new Uint8Array(await res.arrayBuffer());
  const key = await proofKeyFromBase64(p.key);
  try {
    return await decryptProof(ciphertext, key, { code, proofId: p.proofId, kind: p.kind, sha256: p.sha256 });
  } finally {
    key.fill(0);
  }
}

type State = { s: 'loading' } | { s: 'ready'; bytes: Uint8Array } | { s: 'gone' } | { s: 'refused' };

/**
 * A `proof.attached` line: the ciphertext is fetched and decrypted on this device, and the picture
 * is shown only through ProofThumb (the receive check). A proof that does not decrypt or check out
 * is the refusal; one the server no longer has says so.
 */
export function ChatProof({ tradeCode, proof, deps }: { tradeCode: string; proof: ProofAttachedPayload; deps?: ReceiveDeps }) {
  const [state, setState] = useState<State>({ s: 'loading' });
  useEffect(() => {
    let live = true;
    setState({ s: 'loading' });
    openChatProof(tradeCode, proof).then(
      (bytes) => live && setState({ s: 'ready', bytes }),
      (e: unknown) => live && setState({ s: e instanceof ProofGone ? 'gone' : 'refused' }),
    );
    return () => {
      live = false;
    };
  }, [tradeCode, proof]);

  const title = CHAT_PROOF_TITLE[proof.kind];
  return (
    <figure className="x2f-chat-proof" data-part="chat-proof" data-kind={proof.kind}>
      <figcaption className="x2f-chat-proof__title">{title}</figcaption>
      {state.s === 'loading' ? (
        <p className="x2f-proof-thumb__checking" aria-busy="true" data-part="proof-checking">
          {PROOF_CHECKING}
        </p>
      ) : state.s === 'gone' ? (
        <p className="x2f-note" data-part="chat-proof-gone">
          {CHAT_PROOF_GONE}
        </p>
      ) : state.s === 'refused' ? (
        <Notice tone="danger" title={PROOF_REFUSED_TITLE} data-part="proof-refused">
          {PROOF_REFUSED_BODY}
        </Notice>
      ) : (
        <ProofThumb bytes={state.bytes} declared={{ mime: proof.mime, width: proof.width, height: proof.height }} alt={title} {...(deps ? { deps } : {})} />
      )}
    </figure>
  );
}

import { PROOF_MAX_CIPHERTEXT, type ProofAttachedPayload, type ReceiveDeps, decryptProof, proofKeyFromBase64 } from '@x2f/proof';
import { noteProofChecked } from '../../proof/chatProof.js';
import { useEffect, useRef, useState } from 'react';
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

/**
 * The answer's body, at most `cap` bytes (review M5): a stated length over the cap is refused
 * unread, and a body without one is cut as soon as it passes the cap.
 */
async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const stated = res.headers.get('content-length');
  if (stated !== null && !(Number(stated) <= cap)) {
    void res.body?.cancel().catch(() => undefined);
    throw new Error('proof-too-large');
  }
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      void reader.cancel().catch(() => undefined);
      throw new Error('proof-too-large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

type Wanted = Pick<ProofAttachedPayload, 'proofId' | 'key' | 'sha256' | 'kind'>;

/** Fetches and decrypts one proof. Rejects with ProofGone for a 404, anything else for a bad one. */
async function openChatProof(code: string, p: Wanted, f: typeof fetch = globalThis.fetch): Promise<Uint8Array> {
  const res = await f(`/v1/trades/${encodeURIComponent(code)}/proofs/${encodeURIComponent(p.proofId)}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/octet-stream' },
  });
  if (res.status === 404) throw new ProofGone();
  if (!res.ok) throw new Error('proof-unavailable');
  const ciphertext = await readCapped(res, PROOF_MAX_CIPHERTEXT);
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
  const { proofId, sha256 } = proof;
  // The rest of the payload is read when the effect runs, not as a dependency.
  const latest = useRef(proof);
  latest.current = proof;
  /** The decrypted picture while ProofThumb checks it; zeroed once it has (review I5) or when this goes. */
  const plain = useRef<Uint8Array | null>(null);
  const wipe = () => {
    plain.current?.fill(0);
    plain.current = null;
  };
  // Keyed on proofId and sha256, not the line object: every chat poll brings a new snapshot
  // object, and the same proof is fetched, decrypted and checked once (review M5).
  useEffect(() => {
    let live = true;
    setState({ s: 'loading' });
    const { key, kind } = latest.current;
    openChatProof(tradeCode, { proofId, key, sha256, kind }).then(
      (bytes) => {
        if (!live) {
          bytes.fill(0);
          return;
        }
        plain.current = bytes;
        setState({ s: 'ready', bytes });
      },
      (e: unknown) => {
        if (!live) return;
        setState({ s: e instanceof ProofGone ? 'gone' : 'refused' });
        noteProofChecked(proofId, false);
      },
    );
    return () => {
      live = false;
      wipe();
    };
  }, [tradeCode, proofId, sha256]);

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
        <ProofThumb
          bytes={state.bytes}
          declared={{ mime: proof.mime, width: proof.width, height: proof.height }}
          alt={title}
          onChecked={(ok) => {
            noteProofChecked(proofId, ok);
            // ProofThumb shows its own redrawn copy (or the refusal): the plaintext is not needed again.
            wipe();
          }}
          {...(deps ? { deps } : {})}
        />
      )}
    </figure>
  );
}

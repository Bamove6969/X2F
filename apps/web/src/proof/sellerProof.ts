// Plan 5 Task 16: which payment proof the seller's smart proof card shows (SellerConfirm), from the
// trade's chat: the newest `proof.attached` of kind 'proof' the buyer sent. The card itself fetches,
// decrypts and checks it through ChatProof (screens/proof/SmartProofCard.tsx); this module holds
// only the chat's verified line (ids, key and facts, as the chat snapshot already does), in memory.
import { useEffect, useState } from 'react';
import type { ProofAttachedPayload } from '@x2f/proof';
import type { ChatSnapshot } from '../chat/engine.js';
import { chatPaymentDetailsSource, latestChatSnapshot } from '../chat/payDetailsFeed.js';

/** The buyer's newest payment proof in the snapshot (by line id), or null. Evidence, the seller's own lines and missing lines never count. */
export function sellerProofOfSnapshot(snap: ChatSnapshot | null): ProofAttachedPayload | null {
  if (snap === null) return null;
  let newest: ChatSnapshot['lines'][number] | null = null;
  for (const l of snap.lines) {
    if (l.from !== 'buyer' || l.proof?.kind !== 'proof' || l.missing === true) continue;
    if (newest === null || BigInt(l.id) > BigInt(newest.id)) newest = l;
  }
  return newest?.proof ?? null;
}

/** Calls `on` with the buyer's newest payment proof now and on every change; returns the unsubscribe. */
export type SellerProofSource = (code: string, on: (proof: ProofAttachedPayload | null) => void) => () => void;

/**
 * The chat's: the pay-details feed already syncs the trade's chat (or follows an open panel) and
 * keeps its newest snapshot; each publish is a chance the proof changed.
 */
export const chatSellerProofSource: SellerProofSource = (code, on) => {
  let last: ProofAttachedPayload | null | undefined;
  const check = (): void => {
    const p = sellerProofOfSnapshot(latestChatSnapshot(code));
    if (last !== undefined && (last?.proofId ?? null) === (p?.proofId ?? null) && (last?.sha256 ?? null) === (p?.sha256 ?? null)) return;
    last = p;
    on(p);
  };
  const off = chatPaymentDetailsSource(code, check);
  check();
  return off;
};

let source: SellerProofSource = chatSellerProofSource;

/** Tests and the fixture build install their own source; null puts the chat's back. */
export function setSellerProofSource(s: SellerProofSource | null): void {
  source = s ?? chatSellerProofSource;
}

/** The buyer's newest payment proof for `code` while `enabled`, else null. */
export function useSellerProof(code: string, enabled: boolean): ProofAttachedPayload | null {
  const [proof, setProof] = useState<ProofAttachedPayload | null>(null);
  useEffect(() => {
    if (!enabled) {
      setProof(null);
      return;
    }
    let live = true;
    const off = source(code, (p) => {
      if (live) setProof(p);
    });
    return () => {
      live = false;
      off();
    };
  }, [code, enabled]);
  return proof;
}

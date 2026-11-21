// A proof image on the receiving device (row P-031, job J-22; Plan 5 Task 15's ProofThumb, which
// ChatPanel and the paid card use once Task 15 wires the decryption in). It takes the decrypted
// bytes and the type and size the `proof.attached` envelope declares, runs the receiving device's
// check (`showableProof`: header walk, size cap, decode, redraw on a fresh canvas) and shows only
// the redrawn copy. A proof that fails any step is never shown: the user sees a refusal instead.
import { useEffect, useRef, useState } from 'react';
import type { OcrWord, ReceiveDeclared } from '@x2f/proof';
import { Notice } from '../../ui/Notice.js';
import { type ShowDeps, type ShownProof, showableProof } from '../../proof/receive.js';
import './proof.css';

// COPY-UNSIGNED (job J-22: the receiving device's refusal of a broken proof image)
export const PROOF_REFUSED_TITLE = 'Could not show this proof';
// COPY-UNSIGNED (review of 9 Nov 2026, F5: the refusal's own words, not the generic damaged-file copy;
// every refusal code reads the same, since the user can do nothing different for any of them)
export const PROOF_REFUSED_BODY = 'This proof could not be checked safely on your device, so it is not shown.';
// COPY-UNSIGNED
export const PROOF_CHECKING = 'Checking the proof image';

type State = { kind: 'checking' } | { kind: 'shown'; proof: ShownProof } | { kind: 'refused' };

export function ProofThumb({
  bytes,
  declared,
  alt,
  deps,
  onChecked,
  onWords,
}: {
  bytes: Uint8Array;
  declared: ReceiveDeclared;
  alt: string;
  deps?: ShowDeps;
  /** The check's verdict (shown or refused), for the proof state (ChatProof, review M3). */
  onChecked?: (ok: boolean) => void;
  /**
   * Plan 5 Task 16 (the seller's smart proof card): this device's OCR of the redrawn copy, words only;
   * null when they cannot be read or the proof is refused. Read when the effect runs.
   */
  onWords?: (words: OcrWord[] | null) => void;
}) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const { mime, width, height } = declared;
  const report = useRef(onChecked);
  report.current = onChecked;
  const words = useRef(onWords);
  words.current = onWords;
  useEffect(() => {
    let live = true;
    setState({ kind: 'checking' });
    const read = words.current === undefined ? undefined : (w: OcrWord[] | null) => live && words.current?.(w);
    showableProof(bytes, { mime, width, height }, deps, read).then(
      (proof) => {
        if (!live) return;
        setState({ kind: 'shown', proof });
        report.current?.(true);
      },
      // Any failure, ProofReceiveError or not, is a refusal: never the received bytes, never a crash.
      () => {
        if (!live) return;
        setState({ kind: 'refused' });
        report.current?.(false);
        words.current?.(null);
      },
    );
    return () => {
      live = false;
    };
  }, [bytes, mime, width, height, deps]);

  if (state.kind === 'refused') {
    return (
      <Notice tone="danger" title={PROOF_REFUSED_TITLE} data-part="proof-refused">
        {PROOF_REFUSED_BODY}
      </Notice>
    );
  }
  if (state.kind === 'checking') {
    return (
      <p className="x2f-proof-thumb__checking" aria-busy="true" data-part="proof-checking">
        {PROOF_CHECKING}
      </p>
    );
  }
  return <img className="x2f-proof-thumb" src={state.proof.src} width={state.proof.width} height={state.proof.height} alt={alt} data-part="proof-image" />;
}

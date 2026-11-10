// A proof image on the receiving device (row P-031, job J-22; Plan 5 Task 15's ProofThumb, which
// ChatPanel and the paid card use once Task 15 wires the decryption in). It takes the decrypted
// bytes and the type and size the `proof.attached` envelope declares, runs the receiving device's
// check (`showableProof`: header walk, size cap, decode, redraw on a fresh canvas) and shows only
// the redrawn copy. A proof that fails any step is never shown: the user sees a refusal instead.
import { useEffect, useState } from 'react';
import type { ReceiveDeclared, ReceiveDeps } from '@x2f/proof';
import { Notice } from '../../ui/Notice.js';
import { type ShownProof, showableProof } from '../../proof/receive.js';
import './proof.css';

// COPY-UNSIGNED (job J-22: the receiving device's refusal of a broken proof image)
export const PROOF_REFUSED_TITLE = 'Could not show this proof';
// COPY-UNSIGNED (review of 9 Nov 2026, F5: the refusal's own words, not the generic damaged-file copy;
// every refusal code reads the same, since the user can do nothing different for any of them)
export const PROOF_REFUSED_BODY = 'This proof could not be checked safely on your device, so it is not shown.';
// COPY-UNSIGNED
export const PROOF_CHECKING = 'Checking the proof image';

type State = { kind: 'checking' } | { kind: 'shown'; proof: ShownProof } | { kind: 'refused' };

export function ProofThumb({ bytes, declared, alt, deps }: { bytes: Uint8Array; declared: ReceiveDeclared; alt: string; deps?: ReceiveDeps }) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const { mime, width, height } = declared;
  useEffect(() => {
    let live = true;
    setState({ kind: 'checking' });
    showableProof(bytes, { mime, width, height }, deps).then(
      (proof) => live && setState({ kind: 'shown', proof }),
      // Any failure, ProofReceiveError or not, is a refusal: never the received bytes, never a crash.
      () => live && setState({ kind: 'refused' }),
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

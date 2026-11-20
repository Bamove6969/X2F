/**
 * Plan 5 Task 16 on ModCase ("Payment proof"), P5-A36 option (b), the plan's default (lead default,
 * owner question: option (a) would run the OCR check in the moderator's browser, which needs
 * 'wasm-unsafe-eval' and the OCR files on the staff origin). No automatic check runs here: the card
 * says what to look for on the proof, from the case's own figures (the escrow's fiat total and the
 * trade code). The proof image itself waits for the moderator's proof reader
 * (NEEDS_P5_PROOF_ENVELOPE, decision 16 in docs/security/chat-membership-lead-decisions-2026-11-18.md).
 */
import { fiatText } from '../screens/modModel.js';

/** COPY-UNSIGNED: the seller card's closing line, for the moderator. */
export const lookForLine = (total: string, code: string) => `Look for a ${total} payment with the note ${code}.`;

export function ProofLookFor({ fiatCents, currency, code }: { fiatCents: string; currency: string; code: string }) {
  return (
    <p className="x2f-staff-hint" data-part="proof-look-for">
      {lookForLine(fiatText(fiatCents, currency), code)}
    </p>
  );
}

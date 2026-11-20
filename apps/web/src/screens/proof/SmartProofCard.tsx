// Plan 5 Task 16: the smart proof card on SellerConfirm (board SellerConfirm.dc.html, section
// "Payment proof"). The seller's OWN app checks the buyer's screenshot: ChatProof fetches and
// decrypts the blurred copy, ProofThumb runs the receive check and shows the redrawn copy, and this
// device's self-hosted OCR reads that redrawn copy (proof/receive.ts). `checkProof` then compares
// the words with what THIS device expects of the trade (its own total, the trade code, the window
// from the day before the escrow was secured to now). Nothing the buyer says about the picture is
// trusted except what the check itself allows (`hidden`, `photoTakenAt`; see @x2f/proof check.ts).
//
// The card informs and never decides: it does not tick the box, unlock the hold or change
// `releasable`. The board's "Screenshots can be faked" section and the closing bank line stay.
import { type OcrWord, type ProofAttachedPayload, type ProofExpected, checkProof, proofCardLines } from '@x2f/proof';
import { useEffect, useState } from 'react';
import { publicName } from '../../api/trade.js';
import { proofUploadOn } from '../../proof/flag.js';
import { useSellerProof } from '../../proof/sellerProof.js';
import { Icon } from '../../ui/icons.js';
import type { ReleaseTrade } from '../trade/release/view.js';
import { ChatProof } from './ChatProof.js';
import { ProofFakeDisclaimer } from './ProofPrompts.js';
import { FIAT_EXPONENT, proofExpectedOf } from './proofSlot.js';
import './proof.css';

// COPY-UNSIGNED: while this device reads the screenshot (no board state for it).
export const checkingLine = (buyer: string) => `Checking ${buyer}'s screenshot`;
/** The board's heading over the check's lines. */
export const checkedLine = (buyer: string) => `We checked ${buyer}'s screenshot`;

/** How the card writes the trade (board: "mira.k", "$412.50", "K7M2-9QXA-4FTR-8WPN"). */
export interface SmartProofTrade {
  buyer: string;
  total: string;
  code: string;
  currency: string;
  exponent: number;
}

/** The photo's own time from the envelope (`YYYY-MM-DDTHH:MM:00Z`), or null. */
function takenAtOf(p: ProofAttachedPayload): Date | null {
  if (p.photoTakenAt === null) return null;
  const t = Date.parse(p.photoTakenAt);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * The card for one payment proof. `expected` is computed when the words arrive (`expectedAt`),
 * so "now" is the moment of the check.
 */
export function SmartProofCard({
  tradeCode,
  proof,
  trade,
  expectedAt,
  deps,
}: {
  /** The trade the proof is bound to (its AAD), as the room's escrow runs it. */
  tradeCode: string;
  proof: ProofAttachedPayload;
  trade: SmartProofTrade;
  /** What this device expects of the screenshot at the given time; null while it has no total. */
  expectedAt: () => ProofExpected | null;
  /** Tests only: the receive check's parts (and its OCR, proof/receive.ts ShowDeps). */
  deps?: Parameters<typeof ChatProof>[0]['deps'];
}) {
  /** undefined: still reading; null: nothing could be read (or the proof is not shown). */
  const [words, setWords] = useState<OcrWord[] | null | undefined>(undefined);
  const [expected, setExpected] = useState<ProofExpected | null>(null);
  const { proofId, sha256 } = proof;
  useEffect(() => {
    setWords(undefined);
  }, [proofId, sha256]);

  const onWords = (w: OcrWord[] | null) => {
    setExpected(expectedAt());
    setWords(w);
  };

  const card = { buyer: trade.buyer, total: trade.total, code: trade.code, currency: trade.currency, exponent: trade.exponent };
  let lines = proofCardLines({ readable: false, amount: { status: 'not-found', seen: null }, reference: 'not-found', date: 'not-found', name: 'not-found' }, card);
  const reading = words === undefined || expected === null;
  if (!reading) lines = proofCardLines(checkProof(words ?? [], expected, proof.hidden, takenAtOf(proof)), card);
  const closing = lines.at(-1)!;
  const checks = reading ? [] : lines.slice(0, -1);

  return (
    <section aria-label="Payment proof" className="x2f-smart-proof" data-part="smart-proof" data-state={reading ? 'reading' : 'checked'}>
      <div className="x2f-smart-proof__row">
        <div className="x2f-smart-proof__thumb">
          <ChatProof tradeCode={tradeCode} proof={proof} onWords={onWords} {...(deps ? { deps } : {})} />
        </div>
        <div className="x2f-smart-proof__lines" aria-live="polite">
          <span className="x2f-smart-proof__head" data-part="smart-proof-head">
            {reading ? checkingLine(trade.buyer) : checkedLine(trade.buyer)}
          </span>
          {checks.map((l) => (
            <span key={l.text} className="x2f-smart-proof__line" data-tone={l.tone} data-part="smart-proof-line">
              <Icon name={l.tone === 'escrow' ? 'check' : 'alert'} size={16} stroke={2} />
              <span>{l.text}</span>
            </span>
          ))}
        </div>
      </div>
      <p className="x2f-smart-proof__closing" data-part="smart-proof-closing">
        {closing.text}
      </p>
      <ProofFakeDisclaimer />
    </section>
  );
}

/**
 * SellerConfirm's proof slot (`proofSlot`): the card for the buyer's newest payment proof, when this
 * build has the proof feature (VITE_X2F_PROOF_UPLOAD) and this device knows the total. With no
 * proof the card is absent, and the screen's own bank check stays as it is.
 */
export function SellerProofSlot({
  code,
  trade,
  fiatCents,
  total,
  clock,
  enabled = proofUploadOn(),
}: {
  /** The route's trade code (the room's escrow), which the proof is bound to. */
  code: string;
  trade: Pick<ReleaseTrade, 'counterparty' | 'securedAt' | 'lockedRate'>;
  /** The fiat total THIS device accepts (never the API's), in cents; null while it has none. */
  fiatCents: bigint | null;
  /** That total as the screen writes it ("$412.50"). */
  total: string | null;
  clock: () => Date;
  enabled?: boolean;
}) {
  const proof = useSellerProof(code, enabled);
  if (!enabled || proof === null || fiatCents === null || total === null) return null;
  const expectedAt = () => proofExpectedOf({ code, securedAt: trade.securedAt, lockedRate: trade.lockedRate }, { fiatCents, deal: null }, clock());
  const shown = { buyer: publicName(trade.counterparty), total, code, currency: trade.lockedRate.currency, exponent: FIAT_EXPONENT };
  return <SmartProofCard key={proof.proofId} tradeCode={code} proof={proof} trade={shown} expectedAt={expectedAt} />;
}

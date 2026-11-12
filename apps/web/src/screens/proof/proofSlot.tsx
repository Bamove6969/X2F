import type { ProofExpected } from '@x2f/proof';
import type { TradeEscrow, TradeView } from '../trade/payTypes.js';
import { setProofSource } from '../trade/paySeams.js';
import { AddProof, type SendArgs } from './AddProof.js';
import type { PreparedProof } from '../../proof/upload.js';

// COPY-UNSIGNED: a placeholder for design (proof-upload review point 4, lead 2026-11-12). No proof
// goes before the escrow is secured (the chat engine and the API refuse it), so until then the slot
// is the board's disabled one with this line under it.
export const PROOF_AFTER_SECURED = 'Add your proof here after the escrow is secured.';

/** The app keeps fiat in cents (`fiatCents`), so a proof's amount has 2 decimals. */
const FIAT_EXPONENT = 2;
const DAY_MS = 86_400_000;

/**
 * What the poster's checks expect of the screenshot (`uploadPrompts`): this device's total, the
 * trade code, and the window from the day before the escrow was secured to now (check.ts). Null
 * until this device knows the total.
 */
export function proofExpectedOf(
  view: Pick<TradeView, 'code' | 'securedAt' | 'lockedRate'>,
  escrow: Pick<TradeEscrow, 'fiatCents' | 'deal'>,
  now: Date,
): ProofExpected | null {
  if (escrow.fiatCents === null) return null;
  const secured = view.securedAt === null ? now.getTime() : Date.parse(view.securedAt);
  return {
    fiatCents: escrow.fiatCents,
    currency: escrow.deal?.currency ?? view.lockedRate.currency,
    exponent: FIAT_EXPONENT,
    tradeCode: view.code,
    earliest: new Date((Number.isFinite(secured) ? secured : now.getTime()) - DAY_MS),
    latest: now,
  };
}

/**
 * Trades this page sent a proof for. NEEDS_PROOF_RECEIVE: after a reload the page cannot tell yet
 * (the chat does not open `proof.attached` lines), so an unmarked trade reads 'unavailable', never
 * 'none': "Mark paid without proof?" is not asked on a guess.
 */
const sent = new Set<string>();
function installSource(): void {
  setProofSource((code) => (sent.has(code) ? 'attached' : 'unavailable'));
}

/** The board's slot, disabled (flag off until Task 13's OCR and Task 14's storage are both on main). */
function DisabledSlot() {
  return (
    <label htmlFor="proof" className="x2f-proof__slot" aria-disabled="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
        <path d="M12 16V4" />
        <path d="M7 9l5-5 5 5" />
        <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
      </svg>
      <span className="x2f-proof__text">
        <span className="x2f-proof__title">Add payment proof</span>
        <span className="x2f-proof__hint">Private details are blurred for you to check next. Location and device info are removed.</span>
      </span>
      <input id="proof" type="file" accept="image/*" disabled className="x2f-visually-hidden" />
    </label>
  );
}

/**
 * BuyerPay's payment proof slot: the live upload when `enabled` (VITE_X2F_PROOF_UPLOAD=1), the trade
 * is `secured` (from secured on; never while the escrow is securing) and the total is known.
 */
export function ProofSlotLive({
  enabled,
  secured,
  code,
  expected,
  wide,
  prepare,
  send,
}: {
  enabled: boolean;
  secured: boolean;
  code: string;
  expected: ProofExpected | null;
  wide: boolean;
  prepare?: (file: File) => Promise<PreparedProof>;
  send?: (a: SendArgs) => Promise<unknown>;
}) {
  const live = enabled && secured && expected !== null;
  return (
    <section aria-label="Payment proof" className="x2f-proof" data-wide={wide || undefined}>
      {live ? (
        <AddProof
          code={code}
          expected={expected}
          {...(prepare ? { prepare } : {})}
          {...(send ? { send } : {})}
          onSent={() => {
            sent.add(code);
            installSource();
          }}
        />
      ) : (
        <>
          <DisabledSlot />
          {enabled && !secured ? (
            <p className="x2f-note" data-part="proof-after-secured">
              {PROOF_AFTER_SECURED}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

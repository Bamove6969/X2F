import { useId } from 'react';
import { GIFT_CARD_EVIDENCE, GIFT_CARD_TERMS, type GiftCardRole } from '@x2f/trade';
import { CheckRow } from '../../ui/CheckRow.js';
import { GIFT_CARD_COPY, giftCardEvidenceText, giftCardTermText } from './giftCardCopy.js';
import './giftcard.css';

// J-17 (owner F13, T-081): the gift-card tick-box terms (the post form and the quote) and the
// evidence checklist (the trade room). Each side sees only its own (per-reader terms): the XMR buyer
// sends the card, the seller (who holds the escrow) checks it (@x2f/trade giftCardRole). The words
// are COPY-UNSIGNED (giftCardCopy.ts); the layout waits for design's GiftCardBrand board.

/** The reader's tick boxes. `ticked` holds the keys ticked so far; the screen gates its button on all of them. */
export function GiftCardTerms({
  role,
  ticked,
  onChange,
}: {
  role: GiftCardRole;
  ticked: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const titleId = useId();
  return (
    <section className="x2f-giftcard-rules" data-part="gift-card-terms" aria-labelledby={titleId}>
      <h2 id={titleId} className="x2f-section-title">
        {GIFT_CARD_COPY.termsTitle}
      </h2>
      <p className="x2f-giftcard-rules__hint">{GIFT_CARD_COPY.termsHint}</p>
      <ul className="x2f-giftcard-rules__list">
        {GIFT_CARD_TERMS[role].map((k) => (
          <li key={k} data-term={k}>
            <CheckRow
              checked={ticked.has(k)}
              title={giftCardTermText(role, k)}
              onChange={(on) => {
                const next = new Set(ticked);
                if (on) next.add(k);
                else next.delete(k);
                onChange(next);
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The evidence the reader keeps for a dispute (G50, G52). Information only: the uploads are elsewhere. */
export function GiftCardEvidence({ role }: { role: GiftCardRole }) {
  const titleId = useId();
  return (
    <section className="x2f-giftcard-rules" data-part="gift-card-evidence" aria-labelledby={titleId}>
      <h2 id={titleId} className="x2f-section-title">
        {GIFT_CARD_COPY.evidenceTitle}
      </h2>
      <p className="x2f-giftcard-rules__hint">{GIFT_CARD_COPY.evidenceHint}</p>
      <ul className="x2f-giftcard-rules__list x2f-giftcard-rules__list--evidence">
        {GIFT_CARD_EVIDENCE[role].map((e) => (
          <li key={e.key} data-evidence={e.key} data-needed={e.needed} data-seam={e.seam}>
            <span>{giftCardEvidenceText(e.key)}</span>
            {e.needed === 'range-card' ? <span className="x2f-giftcard-rules__hint">{GIFT_CARD_COPY.rangeCardOnly}</span> : null}
            {/* NEEDS(lead, T-054): the video proof upload (G50) replaces this line. */}
            {e.seam === 'video-proof' ? <span className="x2f-giftcard-rules__hint">{GIFT_CARD_COPY.videoComing}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

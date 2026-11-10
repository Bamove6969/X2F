import { useId, useState } from 'react';
import { Icon } from '../../ui/icons.js';
import { TERMS_SUBTITLE, TRADE_TERMS, termsParts, type TermsRole } from './tradeTerms.js';

/**
 * "What applies to you" (build spec j31a section 1; boards BuyQuote, SellQuote(+Wide), OfferAd(+Wide)
 * on wip/design-brief): the reader's own list, three groups with their counts. Collapsed it shows
 * the first line of each group and "Show all N"; open, every line and "Show less". Information
 * only: no agree step. Numbers are in the mono face. COPY-UNSIGNED
 */
export function WhatApplies({ role }: { role: TermsRole }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const groupsId = useId();
  const groups = TRADE_TERMS[role];
  const total = groups.reduce((n, g) => n + g.lines.length, 0);
  return (
    <section aria-labelledby={titleId} className="x2f-wa" data-part="what-applies" data-role={role}>
      <div className="x2f-wa__head">
        <span aria-hidden="true" className="x2f-wa__tile">
          <Icon name="list-check" size={20} stroke={1.75} />
        </span>
        <span className="x2f-wa__head-text">
          <h2 id={titleId} className="x2f-section-title">
            What applies to you
          </h2>
          <span className="x2f-wa__sub">{TERMS_SUBTITLE[role]}</span>
        </span>
      </div>
      <div id={groupsId} className="x2f-wa__groups">
        {groups.map((g) => (
          <div key={g.title} className="x2f-wa__group">
            <div className="x2f-wa__group-head">
              <h3 className="x2f-wa__group-title">{g.title}</h3>
              <span className="x2f-wa__count">{g.lines.length}</span>
            </div>
            <ul aria-label={g.title} className="x2f-wa__lines">
              {(open ? g.lines : g.lines.slice(0, 1)).map((line) => (
                <li key={line} className="x2f-wa__line">
                  <span aria-hidden="true" className="x2f-wa__dot" />
                  <span>
                    {termsParts(line).map((p, i) =>
                      p.mono ? (
                        <span key={i} className="x2f-wa__mono">
                          {p.text}
                        </span>
                      ) : (
                        p.text
                      ),
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <button type="button" className="x2f-wa__toggle" aria-expanded={open} aria-controls={groupsId} onClick={() => setOpen(!open)}>
        {open ? 'Show less' : `Show all ${total}`}
        <Icon name="chevron-down" size={16} stroke={1.75} />
      </button>
    </section>
  );
}

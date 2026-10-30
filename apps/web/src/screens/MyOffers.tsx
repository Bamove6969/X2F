// My offers (Plan 3 Task 36, spec Revision 2026-10-29), after Claude Design's MyOffers board
// (origin/wip/design-brief docs/design-boards/MyOffers.dc.html, 2026-10-29): every live and paused
// offer of mine, each with its own tick box and its own on/off switch. "Select all" only ticks (or
// clears); a bar with Turn on / Turn off applies to the ticked offers. Turning on runs the posting
// guards on the server (method, hold, paused site, wallet, caps); an offer refused stays off and its
// row says why. Turning off always works, and an offer turned off stays off until it is turned on.
//
// TRIPWIRE NEEDS_DESIGN_MYOFFERS (test/myOffers-tripwires.test.ts): the board is not on the main
// line yet, so this is built from the existing kit only (Button, Icon, screens.css and ui.css
// classes) with no CSS of its own and no parity entry. The tick boxes and the switch are kit
// Buttons (role="checkbox" / role="switch"): a native checkbox is under the 32 px tap size and
// styling one would be new CSS. The board's per-offer Edit link waits for an edit screen (Task 35).
// A "can't do that" refusal (trading hold, the offer cap) opens the shared CantDoThat popup with its
// feedback link (Plan 5 Task 21) and leaves a short line on each offer it kept off; the rest
// (maintenance, no wallet, a method off the catalog) are not refusals and stay inline.
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { ApiCallError } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { CantDoThat, type CantDoCode } from '../ui/CantDoThat.js';
import { CANT_DO_TITLE, myOffersCantDoText } from '../ui/cantDoCodes.js';
import { Icon } from '../ui/icons.js';
import { fetchMyOffers, switchOffers, type MyOffer, type OfferState, type SwitchResult } from './myoffers/api.js';
import {
  FOOTNOTE,
  MY_OFFERS_PATH,
  allHint,
  applyResults,
  batches,
  cantDoFor,
  countLine,
  idsFor,
  offerLimits,
  offerMethods,
  offerPrice,
  offerTitle,
  refusalLine,
  statusLine,
  summaryLine,
} from './myoffers/model.js';
import './screens.css';

type Load = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'failed' } | { kind: 'ready'; offers: MyOffer[] };

export function MyOffers() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [refusals, setRefusals] = useState<ReadonlyMap<string, string>>(new Map());
  const [summary, setSummary] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // A "can't do that" refusal on Turn on (a hold, the cap) opens CantDoThat (Plan 5 Task 21).
  const [cantDo, setCantDo] = useState<{ code: CantDoCode; count: number } | null>(null);
  const ids = useId();

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const offers = await fetchMyOffers(signal);
      setLoad({ kind: 'ready', offers });
      // A selection can only hold offers still on the list.
      setSelected((s) => new Set([...s].filter((id) => offers.some((o) => o.id === id))));
    } catch (e) {
      if (signal?.aborted) return;
      setLoad(e instanceof ApiCallError && e.status === 401 ? { kind: 'signed-out' } : { kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void reload(ac.signal);
    return () => ac.abort();
  }, [reload]);

  const offers = load.kind === 'ready' ? load.offers : [];
  const nSelected = offers.filter((o) => selected.has(o.id)).length;
  const allSelected = offers.length > 0 && nSelected === offers.length;

  /** Switches `target` (explicit ids, in batches of SWITCH_BATCH) and shows what happened. */
  async function run(target: string[], status: OfferState, clearSelection: boolean): Promise<void> {
    if (target.length === 0) return;
    setBusy(true);
    setSummary(null);
    setCantDo(null);
    const results: SwitchResult[] = [];
    let failed: unknown = null;
    for (const batch of batches(target)) {
      try {
        results.push(...(await switchOffers(batch, status)));
      } catch (e) {
        failed = e;
        break;
      }
    }
    setBusy(false);
    if (failed instanceof ApiCallError && failed.status === 401) {
      setLoad({ kind: 'signed-out' });
      return;
    }
    setRefusals((before) => {
      const next = new Map(before);
      for (const r of results) {
        if (r.refused !== undefined && r.refused !== 'not-found') next.set(r.id, refusalLine(r.refused));
        else next.delete(r.id);
      }
      return next;
    });
    if (status === 'live') setCantDo(cantDoFor(results));
    if (failed !== null) {
      // COPY-UNSIGNED
      const text = results.length === 0 ? "Something went wrong and your offers weren't changed. Try again." : `${summaryLine(status, results)} The rest weren't changed. Try again.`;
      setSummary({ text, error: true });
    } else {
      setSummary({ text: summaryLine(status, results), error: results.some((r) => r.refused !== undefined) });
      if (clearSelection) setSelected(new Set());
    }
    // An offer removed elsewhere since the list loaded: read the list again.
    if (results.some((r) => r.refused === 'not-found')) await reload();
    else setLoad((l) => (l.kind === 'ready' ? { kind: 'ready', offers: applyResults(l.offers, results) } : l));
  }

  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hintId = `${ids}-all-hint`;

  return (
    <main className="x2f-screen" data-screen="my-offers">
      <header className="x2f-row">
        <Link to="/sell" aria-label="Back" className="x2f-icon-button">
          <Icon name="chevron-left" />
        </Link>
        <div className="x2f-stack">
          <h1 className="x2f-screen__title">My offers</h1>
          {load.kind === 'ready' ? (
            <span className="x2f-note" data-part="count">
              {countLine(offers)}
            </span>
          ) : null}
        </div>
      </header>

      {load.kind === 'loading' ? <p className="x2f-note">Loading…</p> : null}
      {load.kind === 'failed' ? (
        <div className="x2f-stack">
          <p className="x2f-error" role="alert">
            Could not load your offers.
          </p>
          <Button variant="secondary" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : null}
      {load.kind === 'signed-out' ? (
        <p className="x2f-note">
          <Link className="x2f-link" to={`/login?returnTo=${encodeURIComponent(MY_OFFERS_PATH)}`}>
            Log in
          </Link>{' '}
          to see your offers.
        </p>
      ) : null}

      {load.kind === 'ready' && offers.length === 0 ? (
        <p className="x2f-note" data-part="empty">
          You have no offers yet.
        </p>
      ) : null}

      {load.kind === 'ready' && offers.length > 0 ? (
        <>
          <div className="x2f-row" data-part="select-all-row">
            {/* "Select all" only ticks every offer (or clears the ticks); it never turns anything on or off. */}
            <Button
              variant="secondary"
              role="checkbox"
              aria-checked={allSelected ? true : nSelected > 0 ? 'mixed' : false}
              aria-describedby={hintId}
              disabled={busy}
              onClick={() => setSelected(allSelected ? new Set() : new Set(offers.map((o) => o.id)))}
              data-part="select-all"
            >
              {allSelected ? <Icon name="check" size={20} /> : null}
              Select all
            </Button>
            <span className="x2f-note" id={hintId} data-part="all-hint">
              {allHint(nSelected, offers.length)}
            </span>
          </div>

          {summary ? (
            <p className={summary.error ? 'x2f-error' : 'x2f-note'} role={summary.error ? 'alert' : 'status'} data-part="summary">
              {summary.text}
            </p>
          ) : null}

          {cantDo ? (
            <CantDoThat title={CANT_DO_TITLE.myOffers} body={myOffersCantDoText(cantDo.code, cantDo.count)} from={cantDo.code} onClose={() => setCantDo(null)} />
          ) : null}

          <ul className="x2f-list" aria-label="My offers">
            {offers.map((o) => {
              const why = refusals.get(o.id);
              const p = `${ids}-${o.id}`;
              // Each offer's name carries its method, price and limits (review M2): two offers in one
              // market differ by price or limits.
              const parts = `${p}-title ${p}-methods ${p}-price ${p}-limits`;
              const ticked = selected.has(o.id);
              return (
                <li key={o.id} className="x2f-list__row" data-part="offer" data-offer={o.id} data-status={o.status}>
                  <Button
                    variant="secondary"
                    role="checkbox"
                    aria-checked={ticked}
                    aria-labelledby={`${p}-select ${parts}`}
                    disabled={busy}
                    onClick={() => toggleSelected(o.id)}
                    data-part="select"
                  >
                    <span id={`${p}-select`} hidden>
                      Select
                    </span>
                    {ticked ? <Icon name="check" size={20} /> : null}
                  </Button>
                  <div className="x2f-list__label x2f-stack">
                    <span id={`${p}-title`}>{offerTitle(o)}</span>
                    <span className="x2f-note" id={`${p}-methods`}>
                      {offerMethods(o)}
                    </span>
                    <span className="x2f-note" id={`${p}-price`}>
                      {offerPrice(o)}
                    </span>
                    <span className="x2f-note" id={`${p}-limits`}>
                      {offerLimits(o)}
                    </span>
                    <span id={`${p}-status`} data-part="status">
                      {statusLine(o)}
                    </span>
                    {why ? (
                      <span className="x2f-error" id={`${p}-why`} data-part="refused">
                        {why}
                      </span>
                    ) : null}
                  </div>
                  {/* The switch's visible On/Off is the first part of its name (review M3). */}
                  <Button
                    variant="secondary"
                    role="switch"
                    id={`${p}-switch`}
                    aria-checked={o.status === 'live'}
                    aria-labelledby={`${p}-switch ${parts}`}
                    aria-describedby={why ? `${p}-status ${p}-why` : `${p}-status`}
                    disabled={busy}
                    onClick={() => void run([o.id], o.status === 'live' ? 'paused' : 'live', false)}
                    data-part="switch"
                  >
                    {o.status === 'live' ? 'On' : 'Off'}
                  </Button>
                </li>
              );
            })}
          </ul>

          <p className="x2f-note" data-part="footnote">
            {FOOTNOTE}
          </p>

          {nSelected > 0 ? (
            <div className="x2f-row" role="region" aria-label="Selected offers" data-part="bar">
              <span aria-live="polite" data-part="sel-count">
                {nSelected} selected
              </span>
              <Button variant="quiet" disabled={busy} onClick={() => setSelected(new Set())} data-part="clear">
                Clear
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void run(idsFor(offers, selected), 'live', true)} data-part="turn-on">
                Turn on
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void run(idsFor(offers, selected), 'paused', true)} data-part="turn-off">
                Turn off
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {load.kind === 'ready' ? (
        <Link className="x2f-button x2f-button--primary" to="/post" state={{ from: MY_OFFERS_PATH }} data-primary="" data-part="post">
          Post an offer
        </Link>
      ) : null}
    </main>
  );
}

// My offers (Plan 3 Task 36, spec Revision 2026-10-29): every live and paused offer of mine, each
// with an on/off switch, a Select toggle, "Select all", and Turn on / Turn off for the selection. Turning on runs the posting guards on the server (hold, paused site, wallet, caps,
// method); an offer refused stays off and its row says why. Turning off always works.
//
// TRIPWIRE NEEDS_DESIGN_MYOFFERS (test/myOffers-tripwires.test.ts): Claude Design has no board for
// this screen yet (design brief item 3). It is built from the existing kit only (Button and the
// screens.css classes) with no CSS of its own and no parity entry; the switch and the select
// toggles are kit Buttons (role="switch", aria-pressed), since a native checkbox is under the
// 32 px tap size and styling one would be new CSS; match it to the board when it
// lands. Refusals are inline text until Plan 5 Task 21's CantDoThat is on the main line
// (NEEDS_CANTDOTHAT_MYOFFERS).
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { ApiCallError } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { fetchMyOffers, switchOffers, type MyOffer, type OfferState, type SwitchResult } from './myoffers/api.js';
import { MY_OFFERS_PATH, applyResults, idsFor, offerDetail, offerTitle, refusalLine, summaryLine } from './myoffers/model.js';
import './screens.css';

type Load = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'failed' } | { kind: 'ready'; offers: MyOffer[] };

export function MyOffers() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [refusals, setRefusals] = useState<ReadonlyMap<string, string>>(new Map());
  const [summary, setSummary] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
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
  const allSelected = offers.length > 0 && offers.every((o) => selected.has(o.id));
  const someSelected = offers.some((o) => selected.has(o.id));

  async function run(target: string[] | 'all', status: OfferState): Promise<void> {
    setBusy(true);
    setSummary(null);
    let results: SwitchResult[];
    try {
      results = await switchOffers(target, status);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiCallError && e.status === 401) {
        setLoad({ kind: 'signed-out' });
        return;
      }
      // COPY-UNSIGNED
      setSummary({ text: "Something went wrong and your offers weren't changed. Try again.", error: true });
      return;
    }
    setBusy(false);
    setRefusals((before) => {
      const next = new Map(before);
      for (const r of results) {
        if (r.refused !== undefined && r.refused !== 'not-found') next.set(r.id, refusalLine(r.refused));
        else next.delete(r.id);
      }
      return next;
    });
    setSummary({ text: summaryLine(status, results), error: results.some((r) => r.refused !== undefined) });
    const known = new Set(offers.map((o) => o.id));
    // An offer posted or removed elsewhere since the list loaded: read the list again.
    if (results.some((r) => r.refused === 'not-found' || !known.has(r.id))) await reload();
    else setLoad((l) => (l.kind === 'ready' ? { kind: 'ready', offers: applyResults(l.offers, results) } : l));
  }

  const toggleSelected = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <main className="x2f-screen" data-screen="my-offers">
      <h1 className="x2f-screen__title">My offers</h1>

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
          You have no offers yet.{' '}
          <Link className="x2f-link" to="/post" state={{ from: MY_OFFERS_PATH }}>
            Post an offer
          </Link>
        </p>
      ) : null}

      {load.kind === 'ready' && offers.length > 0 ? (
        <>
          <div className="x2f-row" data-part="bulk">
            <Button
              variant="quiet"
              aria-pressed={allSelected ? true : someSelected ? 'mixed' : false}
              disabled={busy}
              onClick={() => setSelected(allSelected ? new Set() : new Set(offers.map((o) => o.id)))}
              data-part="select-all"
            >
              Select all
            </Button>
            <Button variant="secondary" disabled={busy || !someSelected} onClick={() => void run(idsFor(offers, selected), 'live')} data-part="turn-on">
              Turn on
            </Button>
            <Button variant="secondary" disabled={busy || !someSelected} onClick={() => void run(idsFor(offers, selected), 'paused')} data-part="turn-off">
              Turn off
            </Button>
          </div>

          {summary ? (
            <p className={summary.error ? 'x2f-error' : 'x2f-note'} role="status" data-part="summary">
              {summary.text}
            </p>
          ) : null}

          <ul className="x2f-list" aria-label="My offers">
            {offers.map((o) => {
              const why = refusals.get(o.id);
              const titleId = `${ids}-${o.id}-title`;
              const whyId = `${ids}-${o.id}-why`;
              return (
                <li key={o.id} className="x2f-list__row" data-part="offer" data-offer={o.id} data-status={o.status}>
                  <Button
                    variant="quiet"
                    aria-pressed={selected.has(o.id)}
                    aria-label={`Select ${offerTitle(o)}`}
                    disabled={busy}
                    onClick={() => toggleSelected(o.id, !selected.has(o.id))}
                    data-part="select"
                  >
                    {selected.has(o.id) ? 'Selected' : 'Select'}
                  </Button>
                  <div className="x2f-list__label x2f-stack">
                    <span id={titleId}>{offerTitle(o)}</span>
                    <span className="x2f-note">{offerDetail(o)}</span>
                    {why ? (
                      <span className="x2f-error" id={whyId} data-part="refused">
                        {why}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    variant="secondary"
                    role="switch"
                    aria-checked={o.status === 'live'}
                    aria-labelledby={titleId}
                    {...(why ? { 'aria-describedby': whyId } : {})}
                    disabled={busy}
                    onClick={() => void run([o.id], o.status === 'live' ? 'paused' : 'live')}
                    data-part="switch"
                  >
                    {o.status === 'live' ? 'On' : 'Off'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </main>
  );
}

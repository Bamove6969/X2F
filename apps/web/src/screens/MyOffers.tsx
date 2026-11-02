// My offers (Plan 3 Task 36, spec Revision 2026-10-29), after Claude Design's MyOffers board
// (origin/wip/design-brief docs/design-boards/MyOffers.dc.html) and the design review of 1 Nov 2026
// (shots 31-35): every live and paused offer of mine on one grid (tick box | content | switch,
// ui/SelectCard), each with a real 24 px tick box and a real switch. "Select all" only ticks (or
// clears); while offers are ticked, a selection bar with Clear / Turn on / Turn off takes the place
// of "Post an offer" in the footer that stays above the tab bar (ui/ActionBar). Turning on runs the
// posting guards on the server (method, hold, paused site, wallet, caps); an offer refused stays off
// and its row says why. Turning off always works, and an offer turned off stays off until it is
// turned on. During a trading hold the header and every row say so in the caution colour, and the
// summary never counts an offer that was already on as turned on.
//
// A "can't do that" refusal (trading hold, the offer cap) opens the shared CantDoThat popup with its
// feedback link (Plan 5 Task 21); the rest (maintenance, no wallet, a method off the catalog) are
// not refusals and stay inline. Not built yet: the board's per-offer Edit link (no edit screen until
// Task 35), and the Wide board's table layout (tripwire NEEDS_DESIGN_MYOFFERS).
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { ApiCallError } from '../api/client.js';
import { ActionBar } from '../ui/ActionBar.js';
import { Button } from '../ui/Button.js';
import { CantDoThat } from '../ui/CantDoThat.js';
import { CANT_DO_TITLE, MY_OFFERS_HOLD, TRADING_HOLD_CODE, myOffersCantDoText, postCantDoText, type CantDoCode } from '../ui/cantDoCodes.js';
import { Checkbox } from '../ui/Checkbox.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Icon } from '../ui/icons.js';
import { Notice, type NoticeTone } from '../ui/Notice.js';
import { SelectAll } from '../ui/SelectAll.js';
import { SelectCard } from '../ui/SelectCard.js';
import { Switch } from '../ui/Switch.js';
import { fetchMyOffers, switchOffers, type MyOffer, type OfferState, type SwitchResult } from './myoffers/api.js';
import {
  FOOTNOTE,
  MY_OFFERS_PATH,
  allHint,
  applyResults,
  batches,
  countLine,
  idsFor,
  isHeld,
  offerLimitsRange,
  offerMethods,
  offerPriceParts,
  offerTitle,
  refusalLine,
  statusLine,
  summaryLine,
  turnOnPopup,
} from './myoffers/model.js';
import './screens.css';
import { accountTypeOf } from '../session/member.js';
import { useSession } from '../session/useSession.js';
import { ACCOUNT_TYPE_COPY, ACCOUNT_TYPE_PATH } from './settings/accountTypeCopy.js';

type Load = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'failed' } | { kind: 'ready'; offers: MyOffer[] };

export function MyOffers() {
  const trader = accountTypeOf(useSession()) === 'trader';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Each offer a Turn on kept off, by the refusal code (its row line is refusalLine(code)).
  const [refusals, setRefusals] = useState<ReadonlyMap<string, string>>(new Map());
  const [refusedHold, setRefusedHold] = useState(false);
  const [summary, setSummary] = useState<{ text: string; tone: NoticeTone; hold?: true } | null>(null);
  const [busy, setBusy] = useState(false);
  // A "can't do that" refusal on Turn on (a hold, the cap) opens CantDoThat (Plan 5 Task 21): the
  // hold's own popup when it kept every offer off, else "Some offers can't be turned on" with a
  // line per offer kept off (design session 2 Nov 2026).
  const [cantDo, setCantDo] = useState<{ title: string; body: string; from: CantDoCode; items?: string[] | undefined } | null>(null);
  const ids = useId();

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const offers = await fetchMyOffers(signal);
      setLoad({ kind: 'ready', offers });
      // A fresh list says by itself whether a hold hides the live offers (review M1).
      setRefusedHold(false);
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
  const held = isHeld(offers, refusedHold);

  /** Switches `target` (explicit ids, in batches of SWITCH_BATCH) and shows what happened. */
  async function run(target: string[], status: OfferState, clearSelection: boolean): Promise<void> {
    if (target.length === 0) return;
    const before = offers;
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
    setRefusals((was) => {
      const next = new Map(was);
      for (const r of results) {
        if (r.refused !== undefined && r.refused !== 'not-found') next.set(r.id, r.refused);
        else next.delete(r.id);
      }
      return next;
    });
    // Each Turn on says afresh whether a hold refused it (review M1): one that works ends the hold state.
    if (status === 'live') setRefusedHold(results.some((r) => r.refused === TRADING_HOLD_CODE));
    if (status === 'live') {
      const pop = turnOnPopup(results, before);
      const line = (id: string) => {
        const o = before.find((x) => x.id === id);
        const r = results.find((x) => x.id === id);
        return o && r?.refused ? `${offerTitle(o)}, ${offerMethods(o)}: ${refusalLine(r.refused)}` : null;
      };
      setCantDo(
        pop === null
          ? null
          : pop.kind === 'hold'
            ? { title: CANT_DO_TITLE.myOffersHold, body: MY_OFFERS_HOLD.popup, from: TRADING_HOLD_CODE }
            : { title: CANT_DO_TITLE.myOffers, body: myOffersCantDoText(pop.code, pop.count), from: pop.code, items: pop.ids.map(line).filter((t): t is string => t !== null) },
      );
    }
    const said = summaryLine(status, results, before);
    if (failed !== null) {
      // COPY-UNSIGNED
      const text = results.length === 0 ? "Something went wrong and your offers weren't changed. Try again." : `${said.text} The rest weren't changed. Try again.`;
      setSummary({ text, tone: 'danger' });
    } else {
      setSummary(said);
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

  const ready = load.kind === 'ready';
  const listed = ready && offers.length > 0;

  return (
    <main className="x2f-screen" data-screen="my-offers">
      <header className="x2f-row">
        <Link to="/sell" aria-label="Back" className="x2f-icon-button">
          <Icon name="chevron-left" />
        </Link>
        <div className="x2f-stack">
          <h1 className="x2f-screen__title">My offers</h1>
          {listed ? (
            <span className="x2f-note" data-part="count">
              {countLine(offers, held)}
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

      {ready && offers.length === 0 ? (
        // COPY-UNSIGNED (design review 1 Nov 2026, shot 35; its cap sentence is left out, see FOOTNOTE)
        <EmptyState icon="trade" title="No offers yet" data-part="empty">
          Post an offer to buy or sell XMR.
        </EmptyState>
      ) : null}

      {/* During a trading hold: one caution notice at the top (design session 2 Nov 2026); a summary
          that only says the hold again is not shown beside it. */}
      {listed && held ? (
        <Notice tone="caution" title={MY_OFFERS_HOLD.title} data-part="hold-notice">
          {MY_OFFERS_HOLD.body}
        </Notice>
      ) : null}

      {summary && !(held && summary.hold) ? (
        <Notice tone={summary.tone} data-part="summary">
          {summary.text}
        </Notice>
      ) : null}

      {cantDo ? <CantDoThat title={cantDo.title} body={cantDo.body} from={cantDo.from} items={cantDo.items} onClose={() => setCantDo(null)} /> : null}

      {listed ? (
        <>
          {/* "Select all" only ticks every offer (or clears the ticks); it never turns anything on or off. */}
          <SelectAll
            checked={allSelected}
            mixed={nSelected > 0 && !allSelected}
            hint={allHint(nSelected, offers.length)}
            disabled={busy}
            onChange={() => setSelected(allSelected ? new Set() : new Set(offers.map((o) => o.id)))}
          />

          <ul className="x2f-list" aria-label="My offers">
            {offers.map((o) => {
              const code = refusals.get(o.id);
              // During a hold every row already says "Hidden · trading hold"; a second line would repeat it.
              const why = code === undefined || (held && code === TRADING_HOLD_CODE) ? undefined : refusalLine(code);
              const status = statusLine(o, held);
              const [price, priceSub] = offerPriceParts(o);
              const p = `${ids}-${o.id}`;
              // Each offer's name carries its method, price and limits (review M2): two offers in one
              // market differ by price or limits.
              const parts = `${p}-title ${p}-methods ${p}-price ${p}-limits`;
              const ticked = selected.has(o.id);
              const on = o.status === 'live';
              return (
                <SelectCard
                  key={o.id}
                  on={on}
                  selected={ticked}
                  data-part="offer"
                  data-offer={o.id}
                  data-status={o.status}
                  select={<Checkbox checked={ticked} aria-labelledby={`${p}-select ${parts}`} disabled={busy} onChange={() => toggleSelected(o.id)} data-part="select" />}
                  control={
                    <Switch
                      checked={on}
                      id={`${p}-switch`}
                      aria-labelledby={parts}
                      aria-describedby={why ? `${p}-status ${p}-why` : `${p}-status`}
                      // Paused during a trading hold (design session 2 Nov 2026).
                      disabled={busy || held}
                      onClick={() => void run([o.id], on ? 'paused' : 'live', false)}
                      data-part="switch"
                    />
                  }
                >
                  <span id={`${p}-select`} hidden>
                    Select
                  </span>
                  <span className="x2f-select-card__eyebrow" id={`${p}-title`}>
                    {offerTitle(o)}
                  </span>
                  <span className="x2f-select-card__title" id={`${p}-methods`}>
                    {offerMethods(o)}
                  </span>
                  <span className="x2f-select-card__line" id={`${p}-price`}>
                    <span className="x2f-select-card__mono">{price}</span> · {priceSub}
                  </span>
                  <span className="x2f-select-card__line" id={`${p}-limits`}>
                    <span className="x2f-select-card__mono">{offerLimitsRange(o)}</span> per trade
                  </span>
                  <span className="x2f-select-card__status" id={`${p}-status`} data-tone={status.tone} data-chip={held ? 'true' : undefined} data-part="status">
                    {status.text}
                  </span>
                  {why ? (
                    <span className="x2f-select-card__why" id={`${p}-why`} data-part="refused">
                      {why}
                    </span>
                  ) : null}
                </SelectCard>
              );
            })}
          </ul>

          <p className="x2f-note" data-part="footnote">
            {FOOTNOTE}
          </p>
        </>
      ) : null}

      {/* The count's live region is always there, so the first "1 selected" is announced (review N2);
          the bar shows the same words to the eye. */}
      {listed ? (
        <span className="x2f-offscreen" aria-live="polite" data-part="sel-count">
          {nSelected > 0 ? `${nSelected} selected` : ''}
        </span>
      ) : null}

      {listed && nSelected > 0 ? (
        <ActionBar role="region" aria-label="Selected offers" data-selection="true" data-part="bar">
          <span aria-hidden="true">{nSelected} selected</span>
          <Button variant="quiet" disabled={busy} onClick={() => setSelected(new Set())} data-part="clear">
            Clear
          </Button>
          {/* Batch 3 board: Turn on / Turn off are disabled during a trading hold, like the switches. */}
          <Button variant="secondary" disabled={busy || held} onClick={() => void run(idsFor(offers, selected), 'live', true)} data-part="turn-on">
            Turn on
          </Button>
          <Button variant="secondary" disabled={busy || held} onClick={() => void run(idsFor(offers, selected), 'paused', true)} data-part="turn-off">
            Turn off
          </Button>
        </ActionBar>
      ) : ready && trader ? (
        <ActionBar>
          {/* Owner 2 Nov 2026: only vendors post; a trader's way is Settings > Account type. */}
          <Link className="x2f-button x2f-button--primary" to={ACCOUNT_TYPE_PATH} data-primary="" data-part="account-type">
            {ACCOUNT_TYPE_COPY.switchButton}
          </Link>
        </ActionBar>
      ) : ready ? (
        <ActionBar>
          {/* During a trading hold, posting is refused: the CantDoThat popup instead of the form (batch 3). */}
          <Link
            className="x2f-button x2f-button--primary"
            to="/post"
            state={{ from: MY_OFFERS_PATH }}
            data-primary=""
            data-part="post"
            onClick={(e) => {
              if (!held) return;
              e.preventDefault();
              setCantDo({ title: CANT_DO_TITLE.post, body: postCantDoText(TRADING_HOLD_CODE), from: TRADING_HOLD_CODE });
            }}
          >
            Post an offer
          </Link>
        </ActionBar>
      ) : null}
    </main>
  );
}

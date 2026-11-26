/**
 * The Away switch (owner, 26 Nov 2026), a card on Settings, Account (the account owner's tab).
 * `GET /v1/account/away` shows it; the switch saves at once (`PUT /v1/account/away`). On pauses
 * every live offer and says how many; off turns back on only the offers Away paused, each through
 * the relist checks, and lists every one that stayed off with why (the My offers row text). A 24-hour
 * hold refuses the whole off: CantDoThat with the hold sentence. Kit parts only: x2f-card,
 * x2f-setting and the kit Switch. DESIGNER-REVIEW: no board yet.
 */
import { useEffect, useState } from 'react';
import { AuthApiError, type AwayOfferResult, type AwayState } from '@x2f/auth-client';
import { authApi } from '../auth/authApi.js';
import { holdSentence, momentText } from '../auth/refusals.js';
import { fetchMyOffers, type MyOffer } from '../myoffers/api.js';
import { offerMethods, offerTitle, refusalLine } from '../myoffers/model.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { HOLD_CODE } from '../../ui/cantDoCodes.js';
import { Switch } from '../../ui/Switch.js';
import { AWAY_COPY as C } from './awayCopy.js';

/** One line per offer Away could not turn back on: "Selling XMR · USD, Zelle: <why>". */
export function stayedOffLines(results: readonly AwayOfferResult[], before: readonly MyOffer[]): string[] {
  return results
    .filter((r) => r.refused !== undefined && r.refused !== 'not-found')
    .map((r) => {
      const o = before.find((x) => x.id === r.id);
      return `${o ? `${offerTitle(o)}, ${offerMethods(o)}` : C.unnamed}: ${refusalLine(r.refused!)}`;
    });
}

export function AwayCard() {
  const [state, setState] = useState<AwayState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [stayedOff, setStayedOff] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hold, setHold] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    authApi.getAway().then(
      (s) => {
        if (live) setState(s);
      },
      () => {
        if (live) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const toggle = async () => {
    if (state === null) return;
    const away = !state.away;
    setBusy(true);
    setNote(null);
    setStayedOff([]);
    setError(null);
    try {
      // Turning off: my offers first (all paused by Away now), to name the ones that stay off.
      const before = away ? [] : await fetchMyOffers().catch(() => [] as MyOffer[]);
      const r = await authApi.setAway({ away });
      setState({ away: r.away, since: r.since });
      if (r.away) {
        setNote(C.paused(r.paused?.length ?? 0));
      } else {
        const results = r.resumed ?? [];
        const lines = stayedOffLines(results, before);
        const on = results.filter((x) => x.refused === undefined && x.status === 'live').length;
        setNote(C.resumed(on, lines.length));
        setStayedOff(lines);
      }
    } catch (e) {
      if (e instanceof AuthApiError && e.code === HOLD_CODE) setHold(holdSentence(e.holdUntil));
      else setError(C.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="x2f-card" data-part="away" aria-labelledby="settings-away-h">
      <h2 className="x2f-card__title" id="settings-away-h">
        {C.title}
      </h2>
      {loadFailed ? (
        <p className="x2f-error" role="alert">
          {C.loadFailed}
        </p>
      ) : state === null ? null : (
        <div className="x2f-setting">
          <span className="x2f-setting__text">
            <span className="x2f-h3" id="settings-away-l">
              {C.label}
            </span>
            <span className="x2f-fine" id="settings-away-d">
              {C.hint}
            </span>
            {state.away && state.since !== null ? (
              <span className="x2f-fine" data-part="away-since">
                {C.since(momentText(new Date(state.since)))}
              </span>
            ) : null}
          </span>
          <Switch
            checked={state.away}
            onClick={() => void toggle()}
            aria-labelledby="settings-away-l"
            aria-describedby="settings-away-d"
            disabled={busy}
            data-part="away-toggle"
          />
        </div>
      )}
      {note !== null ? (
        <p className="x2f-fine" role="status" data-part="away-result">
          {note}
        </p>
      ) : null}
      {stayedOff.length > 0 ? (
        <ul className="x2f-list" data-part="away-stayed-off">
          {stayedOff.map((t, i) => (
            <li className="x2f-list__row x2f-fine" key={i}>
              {t}
            </li>
          ))}
        </ul>
      ) : null}
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {hold !== null ? <CantDoThat body={hold} from={HOLD_CODE} onClose={() => setHold(null)} /> : null}
    </section>
  );
}

// My trades (/trades; lead job, register D-005): the account's own trades from GET /v1/trades, in
// an Open and a Completed tab (the tab is kept in the address, `?tab=completed`), newest first, a
// page at a time ("Show more" follows the API's cursor). Each row says the code, the caller's side
// and amount, the fiat total, the other side's public name, the state and the date, and opens the
// trade room. A team member without the box for a tab (403 `forbidden`) gets the team-role
// refusal in CantDoThat; OK moves to the other tab, or to Trade when both were refused.
//
// No board yet (the Desktop board left out its "My trades" card until the list existed): built from
// kit parts (the browse screen's tab segment, StatusChip, EmptyState, Notice, Button) and a few lines
// of its own CSS under `x2f-trades-`, for design to restyle. DESIGNER-REVIEW; the words are
// COPY-UNSIGNED (trades/model.ts).
//
// NEEDS_APPEALS_MERGE: the completed-trades list is where wip/lead-appeals' File appeal button goes
// (design spec "Appeals"; Plan 4: "File appeal button on the completed-trades list row"). `rowAction` is that
// seam: once both branches are on the line, App.tsx passes a `rowAction` that renders FileAppeal on
// a Completed row whose dispute is still within its 48 hours. FileAppeal needs the dispute's
// `appealUntil`, which this list does not carry: either GET /v1/trades adds it for disputed trades,
// or the row reads the trade's dispute view (test/tradesList.test.tsx names the seam).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiCallError } from '../api/client.js';
import { publicName } from '../api/trade.js';
import { Button } from '../ui/Button.js';
import { CantDoThat } from '../ui/CantDoThat.js';
import { isCantDoCode, teamCantDoText, teamCantDoTitle, type CantDoCode } from '../ui/cantDoCodes.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Notice } from '../ui/Notice.js';
import { StatusChip } from '../ui/StatusChip.js';
import { fetchTradeList, type TradeListItem, type TradeListStatus } from './trades/api.js';
import { EMPTY, LOAD_FAILED, RETRY, SHOW_MORE, STATE_LABEL, TAB_LABEL, TRADES_TITLE, fiatLine, lastActedLine, sideLine, whenLine } from './trades/model.js';
import './browse/browse.css';
import './screens.css';
import './trades/trades.css';

export const TRADES_PATH = '/trades';

const TABS: readonly TradeListStatus[] = ['open', 'completed'];

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; trades: TradeListItem[]; next: string | null; more: 'idle' | 'busy' | 'failed' }
  | { kind: 'refused'; code: CantDoCode }
  | { kind: 'error' };

function tabOf(raw: string | null): TradeListStatus {
  return raw === 'completed' ? 'completed' : 'open';
}

export function Trades({ rowAction }: { rowAction?: (t: TradeListItem) => ReactNode }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // The tabs the API refused this session (a member without the box), so OK never loops.
  const refused = useRef(new Set<TradeListStatus>());
  const tab = tabOf(params.get('tab'));
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // The tab a page belongs to: an answer for a tab no longer shown is dropped.
  const shownTab = useRef(tab);
  shownTab.current = tab;

  useEffect(() => {
    const ac = new AbortController();
    setLoad({ kind: 'loading' });
    fetchTradeList(tab, null, ac.signal).then(
      (p) => {
        if (!ac.signal.aborted) setLoad({ kind: 'ready', trades: p.trades, next: p.next, more: 'idle' });
      },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        // A rule refusal (a member without the box: 403 forbidden) is CantDoThat's; anything else is a fault.
        if (e instanceof ApiCallError && e.status === 403 && isCantDoCode(e.code)) {
          refused.current.add(tab);
          setLoad({ kind: 'refused', code: e.code });
        } else setLoad({ kind: 'error' });
      },
    );
    return () => ac.abort();
  }, [tab, attempt]);

  const showMore = useCallback(() => {
    if (load.kind !== 'ready' || load.next === null || load.more === 'busy') return;
    const forTab = tab;
    const cursor = load.next;
    setLoad({ ...load, more: 'busy' });
    fetchTradeList(forTab, cursor).then(
      (p) => {
        if (shownTab.current !== forTab) return;
        setLoad((cur) => (cur.kind === 'ready' && cur.next === cursor ? { kind: 'ready', trades: [...cur.trades, ...p.trades], next: p.next, more: 'idle' } : cur));
      },
      () => {
        if (shownTab.current !== forTab) return;
        setLoad((cur) => (cur.kind === 'ready' && cur.next === cursor ? { ...cur, more: 'failed' } : cur));
      },
    );
  }, [load, tab]);

  return (
    <main className="x2f-screen x2f-trades" data-screen="trades">
      <h1 className="x2f-screen-title">{TRADES_TITLE}</h1>
      <div role="tablist" aria-label="Open or completed trades" className="x2f-segment">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`trades-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="trades-panel"
            className="x2f-segment__tab"
            onClick={() => {
              if (t !== tab) setParams(t === 'open' ? {} : { tab: t }, { replace: true });
            }}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <section id="trades-panel" role="tabpanel" aria-labelledby={`trades-tab-${tab}`} aria-busy={load.kind === 'loading'} className="x2f-trades__panel">
        {load.kind === 'refused' ? (
          <CantDoThat
            title={teamCantDoTitle(load.code)}
            body={teamCantDoText(load.code)}
            from={load.code}
            onClose={() => {
              const other = TABS.find((t) => !refused.current.has(t));
              if (other === undefined) void navigate('/sell');
              else setParams(other === 'open' ? {} : { tab: other }, { replace: true });
            }}
          />
        ) : load.kind === 'error' ? (
          <Notice tone="danger" data-part="error">
            {LOAD_FAILED}{' '}
            <Button variant="quiet" onClick={() => setAttempt((n) => n + 1)} data-part="retry">
              {RETRY}
            </Button>
          </Notice>
        ) : load.kind === 'ready' && load.trades.length === 0 ? (
          <EmptyState icon="list-check" title={EMPTY[tab].title} data-part="empty">
            {EMPTY[tab].text}
          </EmptyState>
        ) : load.kind === 'ready' ? (
          <>
            <ul className="x2f-trades__list">
              {load.trades.map((t) => (
                <TradeRow key={t.code} trade={t} action={rowAction?.(t)} />
              ))}
            </ul>
            {load.next !== null ? (
              <div className="x2f-trades__more">
                {load.more === 'failed' ? (
                  <Notice tone="danger" live="alert" data-part="more-error">
                    {LOAD_FAILED}
                  </Notice>
                ) : null}
                <Button variant="secondary" disabled={load.more === 'busy'} onClick={showMore} data-part="more">
                  {load.more === 'failed' ? RETRY : SHOW_MORE}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}

/**
 * The state chip, each tone a literal (re-verify trades-list B2; moderator-badge-scope.test.ts: no
 * tone from a variable outside the dispute screens, and RowTone has no moderator tone).
 */
function StateChip({ state }: { state: TradeListItem['state'] }) {
  const { text, tone, icon } = STATE_LABEL[state];
  switch (tone) {
    case 'caution':
      return <StatusChip tone="caution" icon={icon} label={text} />;
    case 'escrow':
      return <StatusChip tone="escrow" icon={icon} label={text} />;
    case 'neutral':
      return <StatusChip tone="neutral" icon={icon} label={text} />;
  }
}

function TradeRow({ trade: t, action }: { trade: TradeListItem; action: ReactNode }) {
  return (
    <li className="x2f-trades__row" data-part="trade-row" data-state={t.state}>
      <Link to={`/trade/${encodeURIComponent(t.code)}`} className="x2f-trades__link">
        <span className="x2f-trades__top">
          <span className="x2f-trades__side">{sideLine(t)}</span>
          <span className="x2f-trades__fiat x2f-trades__mono">{fiatLine(t)}</span>
        </span>
        <span className="x2f-trades__line">
          with{' '}
          <span className="x2f-trades__name" data-username>
            {publicName(t.counterparty)}
          </span>
        </span>
        <span className="x2f-trades__line">
          <span className="x2f-trades__mono">{t.code}</span> · {whenLine(t)}
        </span>
        {t.lastActedBy ? (
          <span className="x2f-trades__line" data-part="last-acted">
            {lastActedLine(t.lastActedBy)}
          </span>
        ) : null}
        <StateChip state={t.state} />
      </Link>
      {action ? <div className="x2f-trades__action">{action}</div> : null}
    </li>
  );
}

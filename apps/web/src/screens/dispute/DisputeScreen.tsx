// /trade/:code/dispute (Plan 3 Task 27): loads the trade and its dispute, then shows DisputeOpen
// (no dispute yet), DisputeRoom (open, or ?view=chat) or DisputeRuling (once there is a ruling).
// Until Task 19's live events exist it re-reads every 30 s and when the page comes back into view.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useServerClock } from '../../api/client.js';
import { fetchDispute, fetchMethodName, fetchTrade, openDispute, refusalText, sendAppeal, type DisputeTrade, type DisputeView } from './api.js';
import { DisputeOpen } from './DisputeOpen.js';
import { DisputeRoom } from './DisputeRoom.js';
import { DisputeRuling } from './DisputeRuling.js';
import './dispute.css';

const REFRESH_MS = 30_000;

interface Loaded {
  trade: DisputeTrade;
  dispute: DisputeView | null;
  methodName: string;
}

function Ready({ data, reload, setDispute }: { data: Loaded; reload: () => void; setDispute: (d: DisputeView) => void }) {
  const { trade, dispute, methodName } = data;
  const clock = useServerClock(dispute?.serverNow ?? trade.serverNow);
  const [params] = useSearchParams();
  const [, tick] = useState(0);
  // Re-render each 15 s so "wait" turns into "open" when the server's deadline passes.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  if (dispute === null) {
    return (
      <DisputeOpen
        trade={trade}
        methodName={methodName}
        now={clock}
        onOpen={async (reason, note) => {
          try {
            setDispute(await openDispute(trade.code, reason, note));
            reload();
          } catch (err) {
            throw new Error(refusalText(err));
          }
        }}
      />
    );
  }
  if (dispute.ruling !== null && params.get('view') !== 'chat') {
    return (
      <DisputeRuling
        trade={trade}
        methodName={methodName}
        dispute={dispute}
        serverClock={clock}
        onAppeal={async (why) => {
          try {
            setDispute(await sendAppeal(trade.code, why));
          } catch (err) {
            throw new Error(refusalText(err));
          }
        }}
      />
    );
  }
  return <DisputeRoom trade={trade} methodName={methodName} dispute={dispute} serverClock={clock} />;
}

export function DisputeScreen() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const trade = await fetchTrade(code, ac.signal);
        const [dispute, methodName] = await Promise.all([fetchDispute(code, ac.signal), fetchMethodName(trade.methodId, trade.currency, ac.signal)]);
        setData({ trade, dispute, methodName });
        setFailed(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setFailed(true);
        void err;
      }
    })();
    return () => ac.abort();
  }, [code, n]);

  useEffect(() => {
    const id = setInterval(reload, REFRESH_MS);
    const onShow = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [reload]);

  if (data === null) {
    return (
      <main className="dispute-screen" data-screen="dispute" aria-busy={!failed}>
        {failed ? (
          <p className="dispute-error" role="alert">
            {"This trade couldn't be loaded. " /* COPY-UNSIGNED */}
            <button type="button" className="dispute-retry" onClick={() => (code ? reload() : void navigate('/trades'))}>
              Try again
            </button>
          </p>
        ) : null}
      </main>
    );
  }
  return <Ready data={data} reload={reload} setDispute={(d) => setData((cur) => (cur ? { ...cur, dispute: d } : cur))} />;
}

// /trade/:code/dispute (Plan 3 Task 27): loads the trade and its dispute, then shows DisputeOpen
// (no dispute yet), DisputeRoom (open, or ?view=chat) or DisputeRuling (once there is a ruling).
// Inside the trade room a disputed trade shows the same screens through DisputeSlot.tsx; this route
// stays for DisputeOpen and the ?view=chat link, and shows a seller-sends-xmr ruling's tx-proof form
// from the escrow's attested restitution (Task 21 bug 2). It re-reads on the room's one live source
// (useTradeLive: Task 19's connection fanned out, never a second EventSource), when the page comes
// back into view, and every POLL_MS (a moderator's join or ruling is Plan 4's, no live event yet).
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useServerClock } from '../../api/client.js';
import { POLL_MS, useTradeLive } from '../trade/seams.js';
import { useResumeSync } from '../../session/syncFirst.js';
import { useEscrowRestitution } from '../../escrow/useEscrow.js';
import { disputeMethodName, fetchDispute, fetchTrade, openDispute, proofRefusalText, refusalText, sendAppeal, sendPaymentProof, type DisputeTrade, type DisputeView } from './api.js';
import { DisputeOpen } from './DisputeOpen.js';
import { DisputeRoom } from './DisputeRoom.js';
import { DisputeRuling, sameAmount } from './DisputeRuling.js';
import './dispute.css';

interface Loaded {
  trade: DisputeTrade;
  dispute: DisputeView | null;
  methodName: string;
}

/**
 * Which screen a trade gets. A disputed trade never gets the open form: if its dispute record has
 * not arrived (an older escalation, or a read between the two calls), the room shows the dispute
 * from the trade itself, waiting for a moderator.
 */
export type DisputeScreenKind = { kind: 'open' } | { kind: 'room'; dispute: DisputeView } | { kind: 'ruling'; dispute: DisputeView };

export function disputeScreenFor(trade: DisputeTrade, dispute: DisputeView | null, chatView: boolean): DisputeScreenKind {
  if (dispute === null) {
    if (trade.state !== 'disputed') return { kind: 'open' };
    const by = trade.dispute?.by ?? 'system';
    return {
      kind: 'room',
      dispute: {
        openedBy: by,
        reason: by === 'system' ? 'escalated' : 'other',
        openedAt: trade.dispute?.at ?? trade.serverNow,
        afterRefund: false,
        dueAt: null,
        status: 'open',
        moderator: null,
        ruling: null,
        appeal: null,
        serverNow: trade.serverNow,
      },
    };
  }
  if (dispute.ruling !== null && !chatView) return { kind: 'ruling', dispute };
  return { kind: 'room', dispute };
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

  // Task 21 bug 2: the seller's payment a seller-sends-xmr ruling orders, from the escrow's
  // attested terms only (as DisputeSlot), never an API field, and only at the trade amount.
  const restitution = useEscrowRestitution(trade.code);
  const screen = disputeScreenFor(trade, dispute, params.get('view') === 'chat');
  if (screen.kind === 'open') {
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
  if (screen.kind === 'ruling') {
    return (
      <DisputeRuling
        trade={trade}
        methodName={methodName}
        dispute={screen.dispute}
        serverClock={clock}
        onAppeal={async (why) => {
          try {
            setDispute(await sendAppeal(trade.code, why));
          } catch (err) {
            throw new Error(refusalText(err));
          }
        }}
        payTo={restitution !== null && sameAmount(restitution.amountAtomic, trade.amountAtomic) ? restitution : null}
        onTxProof={async (txHash, txKey) => {
          let sent;
          try {
            sent = await sendPaymentProof(trade.code, txHash, txKey);
          } catch (err) {
            throw new Error(proofRefusalText(err));
          }
          reload();
          return sent;
        }}
      />
    );
  }
  return <DisputeRoom trade={trade} methodName={methodName} dispute={screen.dispute} serverClock={clock} />;
}

export function DisputeScreen() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  // C-021: on resume the dispute is read again before its actions work (session/syncFirst.ts).
  useResumeSync(async () => {
    const trade = await fetchTrade(code);
    const dispute = await fetchDispute(code);
    // instr-hash: the method is named from the bundled catalog by id, never from the API.
    setData({ trade, dispute, methodName: disputeMethodName(trade.methodId) });
    setFailed(false);
  });

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const trade = await fetchTrade(code, ac.signal);
        const dispute = await fetchDispute(code, ac.signal);
        const methodName = disputeMethodName(trade.methodId);
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

  useTradeLive(code, reload);

  useEffect(() => {
    const id = setInterval(reload, POLL_MS);
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
            <button type="button" className="dispute-retry" onClick={() => (code ? reload() : void navigate('/sell'))}>
              Try again
            </button>
          </p>
        ) : null}
      </main>
    );
  }
  // The page's one <main> (inside the trade room, DisputeSlot renders in the room's <main>).
  return (
    <main data-screen="dispute">
      <Ready data={data} reload={reload} setDispute={(d) => setData((cur) => (cur ? { ...cur, dispute: d } : cur))} />
    </main>
  );
}

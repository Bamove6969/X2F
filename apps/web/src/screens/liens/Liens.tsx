/**
 * Settings → What you owe (lien recovery, owner 16 Nov 2026, docs/lien-recovery.md): the debtor's
 * notice (owed, paid back so far, still to pay, the current rate) and the creditor's recoveries as
 * they arrive. Figures come from the API only; nothing here moves money. DESIGN: not drawn;
 * COPY-UNSIGNED (liensCopy.ts). NEEDS_DESIGN_LIEN_NOTICE: a line on the quote and the trade room
 * ("this purchase pays X to …") is not placed yet; the trade view carries `lienRecoveryAtomic`.
 */
import { formatXmrExact } from '@x2f/trade';
import { useEffect, useState } from 'react';
import { useSession } from '../../session/useSession.js';
import { fetchLiens, type MyLiens } from './liensApi.js';
import { LIENS_COPY as C, pctOf } from './liensCopy.js';
import '../screens.css';

export const LIENS_PATH = '/settings/liens';

const xmr = (a: bigint) => `${formatXmrExact(a)} XMR`;

export function Liens() {
  const session = useSession();
  const signedIn = session.status === 'signed-in';
  const [data, setData] = useState<MyLiens | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    const ac = new AbortController();
    fetchLiens(ac.signal).then(setData, () => {
      if (!ac.signal.aborted) setFailed(true);
    });
    return () => ac.abort();
  }, [signedIn]);

  return (
    <main className="screen">
      <h1>{C.title}</h1>
      {failed && <p role="alert">{C.loadFailed}</p>}
      {data !== null && data.owes.length === 0 && data.owedTo.length === 0 && <p>{C.none}</p>}
      {data?.owes.map((l) => (
        <section key={l.id} aria-label={C.title} data-lien={l.id}>
          <p>{C.owesIntro(pctOf(l.rateBps))}</p>
          {l.status === 'suspended' && <p>{C.suspended}</p>}
          <dl>
            <dt>{C.owed}</dt>
            <dd>{xmr(l.amountAtomic)}</dd>
            <dt>{C.recovered}</dt>
            <dd>{xmr(l.recoveredAtomic)}</dd>
            <dt>{C.remaining}</dt>
            <dd>{xmr(l.remainingAtomic)}</dd>
            <dt>{C.rate}</dt>
            <dd>{pctOf(l.rateBps)}</dd>
          </dl>
          <p>{C.sellNote}</p>
          <p>{C.fromTrade(l.fromCode)}</p>
        </section>
      ))}
      {data !== null && data.owedTo.length > 0 && (
        <section aria-label={C.owedToTitle}>
          <h2>{C.owedToTitle}</h2>
          <p>{C.owedToIntro}</p>
          {data.owedTo.map((l) => (
            <div key={l.id} data-lien={l.id}>
              <dl>
                <dt>{C.owed}</dt>
                <dd>{xmr(l.amountAtomic)}</dd>
                <dt>{C.received}</dt>
                <dd>{xmr(l.recoveredAtomic)}</dd>
                <dt>{C.remaining}</dt>
                <dd>{xmr(l.remainingAtomic)}</dd>
              </dl>
              {l.status === 'repaid' && <p>{C.repaid}</p>}
              {l.recoveries.length === 0 ? (
                <p>{C.noneYet}</p>
              ) : (
                <ul>
                  {l.recoveries.map((r, i) => (
                    <li key={i}>
                      {xmr(r.amountAtomic)} · {new Date(r.at).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

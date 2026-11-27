import { compromisedTicketLabel, type CompromisedMethod } from '@x2f/staff';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { closeCompromised, codeOf, compromisedReport, compromisedReports, serverNow, unlockAccount, type CompromisedCase, type CompromisedItem, type LockSkip } from '../api.js';
import { faultText } from '../refusals.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import { span } from './modModel.js';
import { utcMinuteText } from './staffFormat.js';
import '../ui/staff.css';

/**
 * "My account has been compromised" reports on the staff site (owner D-059; J-14 ported), under
 * Accounts: the list at /accounts/compromised and one report at /accounts/compromised/:id. Perm
 * `accounts.freeze` (senior moderators and the owner; lead default, owner question pending on
 * whether moderators see them too), as the Accounts page. API: apps/api/src/tickets/compromisedRoutes.ts.
 *
 * - The list: each report's number (CT-n, the one the sender quotes), age, the account it matched
 *   (or none), and whether that account is still locked. No comment here.
 * - A report: the sender's ticked ways to log in and comment, the matched account and its open
 *   trades (paused while the lock holds), "Unlock account" (a security-key tap, `unlock-account`,
 *   bound to the account and the report; trades resume on the timer loop's next pass) and "Close
 *   report" (refused while the account is still locked). Opening a report is written to the
 *   activity log before the comment is read.
 *
 * Staff talk with the sender off the site (the moderator contact link); nothing here messages them.
 * No board draws these pages: DESIGN not drawn, DESIGNER-REVIEW. Every sentence is COPY-UNSIGNED.
 */

/** The ways to log in as staff read them. COPY-UNSIGNED */
export const METHOD_WORDS: Readonly<Record<CompromisedMethod, string>> = {
  passkey: 'Passkey',
  'security-key': 'Security key',
  pgp: 'PGP key',
  authenticator: 'Authenticator app',
  'recovery-code': 'Recovery code',
};

export const COMPROMISED_PATH = '/accounts/compromised';

/**
 * Why a report on a lockable account locked nothing (review of feat/lockout items 1, 3, 4; lead
 * defaults, owner question pending). The sender was answered the same as any other. COPY-UNSIGNED
 */
export const LOCK_SKIP_WORDS: Readonly<Record<LockSkip, string>> = {
  'recent-unlock': 'Not locked: staff unlocked this account less than 30 days ago, so the form does not lock it again. Check with the owner before acting.',
  'legacy-login-name': "Not locked: this is an older account whose login name is still its public Trade Tag, so anyone could have typed it. Contact the owner before acting.",
  'lock-cap': 'Not locked: 20 accounts were already locked from the form in the last hour, so this report was only recorded. Check it and act by hand if it is real.',
};

const methodsText = (m: readonly CompromisedMethod[]) => (m.length === 0 ? 'None of these' : m.map((x) => METHOD_WORDS[x]).join(', '));
const accountText = (r: { matched: boolean; tradeTag: string | null }) => (!r.matched ? 'No account matched' : r.tradeTag ?? 'A team member login');

export function CompromisedList() {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [items, setItems] = useState<CompromisedItem[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setItems(null);
    setFault(null);
    compromisedReports(status).then(
      (r) => {
        if (live) setItems(r.items);
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load the reports just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, [status]);

  const now = serverNow().getTime();
  return (
    <section data-screen="compromised-list">
      <PageTitle title="Compromised accounts">
        <p className="x2f-staff-page__lead">
          Reports from people who say someone else got into their account. Sending one locked the account at once. Check it is really them with a moderator contact, then unlock it.
        </p>
      </PageTitle>
      <p>
        <Link className="x2f-link" to="/accounts">
          Back to Accounts
        </Link>
      </p>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      <div className="x2f-staff-chips" role="group" aria-label="Status" data-part="compromised-filters">
        {(['open', 'closed'] as const).map((s) => (
          <button key={s} type="button" className="x2f-staff-filter" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === 'open' ? 'Open' : 'Closed'}
          </button>
        ))}
      </div>
      {items !== null ? (
        <Table
          label="Compromised account reports"
          rows={items}
          rowKey={(r) => r.id}
          empty={status === 'open' ? 'No open reports.' : 'No closed reports.'}
          columns={[
            {
              title: 'Report',
              cell: (r) => (
                <Link className="x2f-link" to={`${COMPROMISED_PATH}/${r.id}`} data-part="compromised-open">
                  {compromisedTicketLabel(r.number)}
                </Link>
              ),
              mono: true,
            },
            { title: 'Age', cell: (r) => span(now - Date.parse(r.createdAt)), mono: true },
            { title: 'Account', cell: (r) => accountText(r) },
            { title: 'Lock', cell: (r) => (r.locked ? 'Locked' : r.lockSkipped !== null ? 'Not locked (flagged)' : r.matched ? 'Unlocked' : '') },
          ]}
        />
      ) : null}
    </section>
  );
}

export function CompromisedReport() {
  const { id = '' } = useParams();
  const [c, setC] = useState<CompromisedCase | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tapping, setTapping] = useState(false);

  const load = useCallback(async () => {
    try {
      setC(await compromisedReport(id));
    } catch (e) {
      setFault(codeOf(e) === 'not-found' ? 'This report is gone. It was deleted on its retention schedule.' : faultText(e, 'X2F could not load the report just now. Reload to try again.'));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const unlock = async (tapId: string) => {
    setBusy(true);
    setFault(null);
    try {
      await unlockAccount(id, tapId);
      setDone('The account is unlocked and the unlock is logged. Its paused trades carry on within a minute.');
      await load();
    } catch (e) {
      const code = codeOf(e);
      // not-a-refusal: the lock was lifted meanwhile, a changed state.
      if (code === 'wrong-state') setFault('This account is no longer locked. The report is up to date now.');
      else if (code === 'tap-invalid') setFault('The tap did not match this unlock. Try again.');
      else setFault(faultText(e, 'X2F could not unlock the account just now. Try again.'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setBusy(true);
    setFault(null);
    try {
      await closeCompromised(id);
      setDone('The report is closed and logged.');
      await load();
    } catch (e) {
      // not-a-refusal: the account must be unlocked first, said where the button is.
      if (codeOf(e) === 'account-locked') setFault('Unlock the account first. A report closes only once its account is unlocked.');
      else setFault(faultText(e, 'X2F could not close the report just now. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const a = c?.account ?? null;
  const locked = a !== null && a.lockedAt !== null;
  const name = a === null ? '' : a.tradeTag ?? (a.team !== null ? `a team member login of ${a.team}` : 'a team member login');
  return (
    <section data-screen="compromised-report">
      <PageTitle title={c !== null ? `Report ${compromisedTicketLabel(c.number)}` : 'Report'}>
        {c !== null ? (
          <p className="x2f-staff-page__lead" data-part="report-facts">
            {c.status === 'closed' ? 'Closed' : 'Open'} · sent <span className="x2f-staff-code">{utcMinuteText(c.createdAt)}</span>
          </p>
        ) : null}
      </PageTitle>
      <p>
        <Link className="x2f-link" to={COMPROMISED_PATH}>
          Back to reports
        </Link>
      </p>
      {fault !== null ? (
        <Notice tone="danger" data-part="report-fault">
          {fault}
        </Notice>
      ) : null}
      {done !== null ? (
        <Notice tone="info" data-part="report-done">
          {done}
        </Notice>
      ) : null}
      {c !== null ? (
        <div className="x2f-stack">
          <dl className="x2f-staff-facts" data-part="report-sender">
            <div>
              <dt>Still has</dt>
              <dd>{methodsText(c.methodsLeft)}</dd>
            </div>
            <div>
              <dt>Comment</dt>
              <dd className="x2f-staff-thread__body">{c.comment ?? 'No comment'}</dd>
            </div>
          </dl>
          {c.lockSkipped !== null ? (
            <Notice tone="caution" data-part="report-lock-skipped">
              {LOCK_SKIP_WORDS[c.lockSkipped]}
            </Notice>
          ) : null}
          {a === null ? (
            <Notice tone="plain" data-part="report-no-account">
              The name the sender typed matched no account that the form locks. Nothing was locked.
            </Notice>
          ) : (
            <section className="x2f-stack" aria-label="Account" data-part="report-account">
              <dl className="x2f-staff-facts">
                <div>
                  <dt>Account</dt>
                  <dd>{name}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd className="x2f-staff-code">{utcMinuteText(a.createdAt)}</dd>
                </div>
                <div>
                  <dt>Lock</dt>
                  <dd data-part="report-lock">{a.lockedAt !== null ? `Locked since ${utcMinuteText(a.lockedAt)}` : 'Not locked'}</dd>
                </div>
              </dl>
              <Table
                label="Open trades"
                rows={a.openTrades}
                rowKey={(t) => t.code}
                empty="No open trades."
                columns={[
                  { title: 'Trade', cell: (t) => t.code, mono: true },
                  { title: 'Side', cell: (t) => (t.side === 'seller' ? 'Selling' : 'Buying') },
                  { title: 'State', cell: (t) => t.state },
                  { title: 'Paused', cell: (t) => (t.paused ? 'Paused' : '') },
                ]}
              />
            </section>
          )}
          <div className="x2f-staff-actions">
            {locked ? (
              <Button variant="primary" disabled={busy} data-part="report-unlock" onClick={() => setTapping(true)}>
                Unlock account
              </Button>
            ) : null}
            {c.status !== 'closed' ? (
              <Button variant={locked ? 'secondary' : 'primary'} disabled={busy || locked} data-part="report-close" onClick={() => void close()}>
                Close report
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {tapping && a !== null && c !== null ? (
        <KeyTapDialog
          intent={{ kind: 'unlock-account', accountId: a.id, ticketId: c.id }}
          title={`Unlock ${name}`}
          body={`The lock ends now: ${name} can log in again, and its paused trades carry on where they stopped. Do this only once a moderator has checked it is really the owner. The unlock is written to the activity log.`}
          labels={{ accountId: name, ticketId: `report ${compromisedTicketLabel(c.number)}` }}
          onCancel={() => setTapping(false)}
          onDone={(tapId) => {
            setTapping(false);
            void unlock(tapId);
          }}
        />
      ) : null}
    </section>
  );
}

import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { markAllOwnerAlertsRead, markOwnerAlertRead, ownerAlerts, type OwnerAlert } from '../api.js';
import { faultText } from '../refusals.js';
import { AlertsCountContext } from '../ui/alertsCount.js';
import { Button, EmptyState, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';

/**
 * The owner's notifications page (O-040, owner Q35: "Owner notification when a currency drops or
 * returns"): every owner alert, newest first, unread ones marked, each marked read on its own or
 * all at once. The shell's badge shows the unread count (`AlertsCountContext`).
 *
 * No board yet (O-040 NOT DRAWN). DESIGNER-REVIEW. Every sentence here is draft copy. COPY-UNSIGNED
 */

/** What each alert is called when it carries no sentence of its own. COPY-UNSIGNED */
export const ALERT_TITLES: Readonly<Record<string, string>> = {
  'price-source-failing': 'A price source is failing',
  'price-source-recovered': 'A price source is back',
  'market-prices-paused': 'Market prices paused',
  'market-prices-resumed': 'Market prices back',
  'price-route-backup': 'A currency is priced by a backup route',
  'price-route-primary': 'A currency is priced by its first route again',
  'auto-close-capped': 'Inactive accounts: the automatic close stopped at its limit for this run',
  'dispute-refund-after-ruling': 'A refund landed after a ruling: the case needs a new ruling',
  'dispute-comply-lapsed': 'A seller did not prove the payment a ruling ordered: the case needs a senior moderator',
  // COPY-UNSIGNED (owner 26 Nov 2026, "Pool first, auto-assign if untaken"): nobody eligible was on shift.
  'dispute-unassigned-overdue': 'A dispute is still unassigned past its reply deadline: nobody who could take it is on shift',
  'tx-proof-check-stuck': 'The payment proof checker is stuck: restart the API so sellers can prove their payments',
  'tx-proof-check-stopped': 'The payment proof checker has stopped: no seller can prove a payment until the API is restarted',
  // COPY-UNSIGNED (review of feat/lockout, item 4).
  'compromised-lock-cap': 'Many compromised-account reports at once: for the rest of this hour new ones are recorded without locking accounts',
  'fee-sweep-due': 'Fee wallet sweep',
  'fee-sweep-failed': 'Fee wallet sweep did not go through',
  // COPY-UNSIGNED (owner 26 Nov): the payroll wallet's automatic staff pay.
  'payroll-send-refused': 'The payroll wallet could not pay a staff member yet',
  'payroll-send-unknown': 'A staff payout may not have gone through: check the payroll wallet',
  'payroll-send-blocked': 'A staff payout was stopped: its address does not match its key tap',
  'new-login': 'New login to the owner account',
  'login-method-added': 'Login method added',
  'login-method-removed': 'Login method removed',
  'sessions-ended': 'Sessions ended',
  // COPY-UNSIGNED (owner 26 Nov 2026, lien grace and shares).
  'lien-grace-lapsed': 'The 7 days to pay the agreed way passed without the person owed confirming',
  'lien-grace-escalated': 'A lien whose 7 days to pay passed waits for a senior moderator',
  'lien-rate-requested': 'A lower share for a lien waits for your approval',
};
export const alertTitle = (kind: string): string => ALERT_TITLES[kind] ?? 'Notice';

/**
 * Coordinator follow-up 26 Nov 2026: a lien alert links to its case, where the lien panel is (the
 * case of the trade the lien came from). Null for any other alert or a malformed trade code.
 */
export function alertCaseLink(kind: string, detail: unknown): string | null {
  if (!kind.startsWith('lien-') || detail === null || typeof detail !== 'object') return null;
  const t = (detail as Record<string, unknown>).trade;
  return typeof t === 'string' && /^[A-Za-z0-9-]{4,64}$/.test(t) ? `/disputes/${encodeURIComponent(t)}` : null;
}

export const CASE_LINK_TEXT = 'Open the case';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function OwnerAlerts() {
  const { refresh } = useContext(AlertsCountContext);
  const [items, setItems] = useState<OwnerAlert[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await ownerAlerts();
      setItems(r.items);
      setNext(r.next);
      setFault(null);
    } catch (e) {
      setFault(faultText(e, 'Your notifications could not be loaded. Try again.'));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const more = async () => {
    if (next === null) return;
    try {
      const r = await ownerAlerts(next);
      setItems((cur) => [...(cur ?? []), ...r.items]);
      setNext(r.next);
    } catch (e) {
      setFault(faultText(e, 'More notifications could not be loaded. Try again.'));
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
      refresh();
    } catch (e) {
      setFault(faultText(e, 'That did not go through. Try again.'));
    }
  };

  const anyUnread = items?.some((a) => a.seenAt === null) ?? false;
  return (
    <div className="x2f-stack" data-screen="owner-alerts">
      <PageTitle title="Notifications">
        {anyUnread ? (
          <Button variant="quiet" onClick={() => void act(markAllOwnerAlertsRead)}>
            Mark all as read
          </Button>
        ) : null}
      </PageTitle>
      {fault !== null ? (
        <Notice tone="danger" data-part="owner-alerts-fault">
          {fault}
        </Notice>
      ) : null}
      {items !== null && items.length === 0 ? (
        <EmptyState icon="shield" title="No notifications yet">
          Price, fee wallet and account notices for the owner appear here.
        </EmptyState>
      ) : null}
      {items !== null && items.length > 0 ? (
        <ul className="x2f-stack" aria-label="Notifications">
          {items.map((a) => (
            <li key={a.id} className="x2f-card" data-part="alert-row" data-unread={a.seenAt === null ? 'true' : 'false'}>
              <p>
                <strong>{alertTitle(a.kind)}</strong>
                {a.seenAt === null ? <span data-part="alert-unread"> · New</span> : null}
              </p>
              {a.message !== null ? <p>{a.message}</p> : null}
              {alertCaseLink(a.kind, a.detail) !== null ? (
                <p>
                  <Link className="x2f-link" data-part="alert-case" to={alertCaseLink(a.kind, a.detail)!}>
                    {CASE_LINK_TEXT}
                  </Link>
                </p>
              ) : null}
              <p className="x2f-staff-page__lead">{when(a.createdAt)}</p>
              {a.seenAt === null ? (
                <Button variant="quiet" onClick={() => void act(() => markOwnerAlertRead(a.id))}>
                  Mark as read
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {next !== null ? (
        <Button variant="quiet" onClick={() => void more()}>
          Show older
        </Button>
      ) : null}
    </div>
  );
}

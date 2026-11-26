import { can, type StaffRole } from '@x2f/staff';
import { useId, useState, type FormEvent } from 'react';
import { lookupAccounts, type LookedUpAccount } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, EmptyState, Notice } from '../ui/kit.js';
import { PageTitle, useMe } from '../ui/StaffShell.js';
import { AccountCard } from './AccountActions.js';
import '../ui/staff.css';

/** The API's longest query (apps/api staff/accountLookup.ts LOOKUP_QUERY_MAX). */
const QUERY_MAX = 64;

/**
 * The Accounts page (spec 6.6 "Account actions"; no board, DESIGN not drawn, DESIGNER-REVIEW):
 * a senior moderator or the owner finds a trader by public display name or trade code and acts on
 * the account outside a case, with the same card and actions as ModCase's Account actions
 * (AccountActions.tsx). The menu shows it only to the roles the API serves it to (NAV_PERM
 * `accounts.freeze`); the API refuses the lookup to anyone else too. Each lookup is written to the
 * activity log. Every sentence is COPY-UNSIGNED.
 */
export function Accounts() {
  const who = useMe();
  if (who === null) return null;
  return <AccountsPage role={who.role} />;
}

export function AccountsPage({ role }: { role: StaffRole }) {
  const inputId = useId();
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [found, setFound] = useState<LookedUpAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const query = q.trim();

  const run = async (text: string) => {
    setBusy(true);
    setFault(null);
    try {
      const r = await lookupAccounts(text);
      setFound(r.accounts);
      setAsked(text);
    } catch (e) {
      const x = refusalOf(e);
      if (x !== null) setRefusal(x);
      else setFault(faultText(e, 'The lookup did not go through just now. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query !== '' && query.length <= QUERY_MAX) void run(query);
  };

  return (
    <section data-screen="accounts">
      <PageTitle title="Accounts">
        <p className="x2f-staff-page__lead">Find a trader by display name or trade code, then ban, lift a ban or work an account hold. Each lookup is written to the activity log.</p>
      </PageTitle>
      {!can(role, 'accounts.freeze') ? (
        // not-a-refusal: the shell never shows this page to such a role; a fallback line only.
        <Notice tone="plain">Account actions are for senior moderators and the owner.</Notice>
      ) : (
        <>
          <form className="x2f-staff-hours-row" onSubmit={submit} data-part="account-lookup">
            <label className="x2f-label" htmlFor={inputId}>
              Display name or trade code
            </label>
            <input id={inputId} className="x2f-input" autoComplete="off" spellCheck={false} maxLength={QUERY_MAX} value={q} onChange={(e) => setQ(e.target.value)} data-mask="" />
            <Button variant="primary" type="submit" disabled={busy || query === ''}>
              Look up
            </Button>
          </form>
          <p className="x2f-staff-hint">Exact matches only. A trade code finds both of its traders.</p>
          {fault !== null ? (
            <Notice tone="danger" data-part="lookup-fault">
              {fault}
            </Notice>
          ) : null}
          {found !== null && found.length === 0 ? (
            <EmptyState icon="shield" title="No trader found" data-part="lookup-empty">
              {`No trader has the display name or trade code "${asked ?? ''}".`}
            </EmptyState>
          ) : null}
          <div className="x2f-stack">
            {(found ?? []).map((a) => (
              <AccountCard key={`${a.accountId}-${a.side ?? 'name'}`} account={a} role={role} onChanged={() => (asked !== null ? run(asked) : Promise.resolve())} />
            ))}
          </div>
        </>
      )}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </section>
  );
}

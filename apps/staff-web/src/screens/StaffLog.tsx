import { normalizeTradeCode } from '@x2f/staff';
import { useEffect, useId, useState } from 'react';
import {
  activeDisputes,
  checkLogIntegrity,
  logFilters,
  logPage,
  logStatus,
  type ActiveDispute,
  type LogEntry,
  type LogIntegrity,
  type LogKind,
  type LogQuery,
  type LogStatus,
} from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { PageTitle, useMe } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import '../ui/staff.css';
import { KIND_LABELS, activeLabel, describeLog, tradeText, whenText, whoName, whoRole } from './logModel.js';
import { hhmm } from './modModel.js';

/**
 * Plan 4 Task 19: the Activity log page (board StaffLog). The owner reads every entry; a senior
 * moderator or a moderator reads the staff scope (disputed trades only, never staff, settings,
 * owner, site, pay or news entries: the API decides). Filters: the trade code (with or without
 * dashes, board), the Active disputes list (board), and, not on the board (DESIGNER-REVIEW), who
 * acted, the kind of entry and a date range. 50 entries a page, "Show older entries".
 * The owner also sees the moderation process's log alarm (A8's sentence, Task 17's log-alarm card)
 * and the chain check. Review m7: the page load reads only the entry count and the alarm; the
 * chain check (the whole log re-hashed by the API from its first entry) runs when the owner taps
 * "Check integrity". The Active disputes list is paged (100 at a time, "Show more").
 * Copy beyond the board's is draft. COPY-UNSIGNED
 */
export function StaffLog() {
  const me = useMe();
  const owner = me?.role === 'owner';
  const [q, setQ] = useState('');
  const [actor, setActor] = useState('');
  const [kind, setKind] = useState<LogKind | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [next, setNext] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveDispute[]>([]);
  const [activeNext, setActiveNext] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ actors: Array<{ id: string; name: string; role: string | null }>; kinds: LogKind[] } | null>(null);
  const [status, setStatus] = useState<LogStatus | null>(null);
  const [integrity, setIntegrity] = useState<LogIntegrity | null>(null);
  const [checking, setChecking] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const ids = { q: useId(), active: useId(), actor: useId(), kind: useId(), from: useId(), to: useId() };

  const typed = q.trim();
  const code = typed === '' ? null : normalizeTradeCode(typed);
  const badCode = typed !== '' && code === null;
  const query: LogQuery = { ...(code ? { code } : {}), actor, kind, from, to };
  const key = JSON.stringify(query);
  const filtered = typed !== '' || actor !== '' || kind !== '' || from !== '' || to !== '';

  useEffect(() => {
    let live = true;
    Promise.all([activeDisputes(), logFilters()]).then(
      ([a, f]) => {
        if (!live) return;
        setActive(a.items);
        setActiveNext(a.next ?? null);
        setFilters(f);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  // Review m7: the count and the alarm only; the chain is checked when the owner asks.
  useEffect(() => {
    if (!owner) return;
    let live = true;
    logStatus().then(
      (v) => {
        if (live) setStatus(v);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [owner]);

  useEffect(() => {
    if (badCode) {
      setEntries([]);
      setNext(null);
      return;
    }
    let live = true;
    setFault(null);
    logPage(query).then(
      (p) => {
        if (!live) return;
        setEntries(p.entries);
        setNames(p.names);
        setNext(p.next);
      },
      (e: unknown) => {
        if (live) setFault(faultText(e, 'X2F could not load the activity log just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, badCode]);

  async function check() {
    setChecking(true);
    try {
      setIntegrity(await checkLogIntegrity());
    } catch (e) {
      setFault(faultText(e, 'X2F could not check the activity log just now. Try again.'));
    } finally {
      setChecking(false);
    }
  }

  async function moreActive() {
    if (activeNext === null) return;
    try {
      const p = await activeDisputes(activeNext);
      setActive((cur) => [...cur, ...p.items]);
      setActiveNext(p.next ?? null);
    } catch (e) {
      setFault(faultText(e, 'X2F could not load more active disputes. Try again.'));
    }
  }

  async function older() {
    if (next === null) return;
    try {
      const p = await logPage({ ...query, before: next });
      setEntries((cur) => [...(cur ?? []), ...p.entries]);
      setNames((cur) => ({ ...cur, ...p.names }));
      setNext(p.next);
    } catch (e) {
      setFault(faultText(e, 'X2F could not load older entries. Try again.'));
    }
  }

  const clear = () => {
    setQ('');
    setActor('');
    setKind('');
    setFrom('');
    setTo('');
  };

  const shownCode = typed.toUpperCase();
  let summary = '';
  if (entries !== null) {
    if (typed !== '') summary = entries.length > 0 ? `${entries.length}${next ? '+' : ''} entries for trade ${shownCode}, newest first.` : `No entries for ${shownCode}. Check the code and try again.`;
    else if (filtered) summary = entries.length > 0 ? `${entries.length}${next ? '+' : ''} entries, newest first.` : 'No entries match these filters.';
    else summary = owner ? 'Showing everything, newest first.' : 'Showing every entry on disputed trades, newest first.';
  }
  const now = new Date();

  return (
    <section data-screen="staff-log" className="x2f-staff-log">
      <PageTitle title="Activity log">
        <p className="x2f-staff-page__lead">
          {/* not-a-refusal: board StaffLog's description of the log, not a rule that stops the user */}
          Every staff action and every step of every trade. Entries can't be edited or deleted by anyone. Opening a dispute chat or an unblurred proof always appears here.
        </p>
      </PageTitle>
      {owner ? <Integrity status={status} v={integrity} checking={checking} onCheck={() => void check()} /> : null}
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      <div className="x2f-staff-log__filters">
        <label htmlFor={ids.q} className="x2f-sr-only">
          Trade code
        </label>
        <input
          id={ids.q}
          type="search"
          className="x2f-input x2f-staff-log__code"
          placeholder="Type or paste a trade code"
          spellCheck={false}
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label htmlFor={ids.active} className="x2f-sr-only">
          Active disputes
        </label>
        <select
          id={ids.active}
          className="x2f-input x2f-staff-log__select"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === MORE) void moreActive();
            else if (v !== '') setQ(tradeText(v));
          }}
        >
          <option value="">{`Active disputes (${active.length}${activeNext !== null ? '+' : ''})`}</option>
          {active.map((a) => (
            <option key={a.code} value={a.code}>
              {activeLabel(a)}
            </option>
          ))}
          {/* Review m7: the next 100. COPY-UNSIGNED */}
          {activeNext !== null ? <option value={MORE}>Show more active disputes</option> : null}
        </select>
        {filtered ? (
          <button type="button" className="x2f-staff-log__clear" onClick={clear}>
            {owner ? 'Show everything' : 'Clear filters'}
          </button>
        ) : null}
      </div>
      <div className="x2f-staff-log__filters" data-part="more-filters">
        <label htmlFor={ids.actor} className="x2f-sr-only">
          Who
        </label>
        <select id={ids.actor} className="x2f-input x2f-staff-log__select" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">Anyone</option>
          <option value="system">System</option>
          <option value="buyer">Buyers</option>
          <option value="seller">Sellers</option>
          {(filters?.actors ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <label htmlFor={ids.kind} className="x2f-sr-only">
          Kind
        </label>
        <select id={ids.kind} className="x2f-input x2f-staff-log__select" value={kind} onChange={(e) => setKind(e.target.value as LogKind | '')}>
          <option value="">Every kind</option>
          {(filters?.kinds ?? []).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label htmlFor={ids.from} className="x2f-staff-log__date-label">
          From
        </label>
        <input id={ids.from} type="date" className="x2f-input x2f-staff-log__date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <label htmlFor={ids.to} className="x2f-staff-log__date-label">
          To
        </label>
        <input id={ids.to} type="date" className="x2f-input x2f-staff-log__date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </div>
      <span className="x2f-staff-log__summary" data-part="summary">
        {summary}
      </span>
      <div className="x2f-staff-log__scroll">
        <Table
          label="Activity log"
          rows={entries ?? []}
          rowKey={(r) => r.id}
          columns={[
            { title: 'When', cell: (r) => <span className="x2f-staff-log__when">{whenText(r.at, now)}</span> },
            { title: 'Trade', cell: (r) => <span data-part="log-code">{tradeText(r.tradeCode)}</span>, mono: true },
            {
              title: 'Who',
              cell: (r) => (
                <span className="x2f-staff-log__who">
                  <span className="x2f-staff-log__name" data-username="">
                    {whoName(r)}
                  </span>{' '}
                  <span className="x2f-staff-log__role">{whoRole(r)}</span>
                </span>
              ),
            },
            { title: 'What happened', cell: (r) => describeLog(r, names) },
          ]}
        />
      </div>
      {next !== null ? (
        <Button variant="secondary" onClick={() => void older()}>
          Show older entries
        </Button>
      ) : null}
      <p className="x2f-staff-log__foot">
        Every trade gets a random 16-character code in four groups (letters and numbers, no look-alikes such as 0 and O). You can search with or without the dashes. Codes reveal nothing about how many trades X2F handles.
      </p>
    </section>
  );
}

/** The Active disputes menu's "Show more" value: never a trade code (codes have dashes and no colon). */
const MORE = 'more:';

/**
 * The owner's chain check and log alarm. No board (DESIGNER-REVIEW). Review m7: before the owner
 * taps "Check integrity" the page says how many entries a check reads; the check itself is the
 * whole chain from its first entry. COPY-UNSIGNED
 */
function Integrity({ status, v, checking, onCheck }: { status: LogStatus | null; v: LogIntegrity | null; checking: boolean; onCheck: () => void }) {
  const alarm = v?.alarm ?? status?.alarm ?? null;
  return (
    <div className="x2f-staff-log__integrity" data-part="integrity">
      {alarm ? <Notice tone="danger">{`The activity log failed its integrity check at ${hhmm(alarm)}. Contact your security reviewer.`}</Notice> : null}
      {v === null ? (
        <span className="x2f-staff-log__check" data-part="integrity-unchecked">
          {checking
            ? 'Checking the activity log…'
            : status !== null
              ? `Not checked on this visit. A check re-reads all ${status.entries} entries and confirms each links to the one before it.`
              : ''}
        </span>
      ) : v.chain.ok ? (
        <span className="x2f-staff-log__check" data-ok="true">
          {`Chain check passed at ${hhmm(v.checkedAt)}: all ${v.entries} entries link up and none has been changed.`}
        </span>
      ) : (
        <Notice tone="danger">{`Chain check failed at entry ${v.chain.brokenAt}: an entry was changed or removed. Contact your security reviewer.`}</Notice>
      )}
      <button type="button" className="x2f-staff-log__clear" disabled={checking} onClick={onCheck}>
        {v === null ? 'Check integrity' : 'Check again'}
      </button>
    </div>
  );
}

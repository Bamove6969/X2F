/**
 * Settings → Team → Team log (team audit v2; owner 26 Nov 2026: "do a really good job at the audit
 * tools"). The account owner's full log of the team: every member action, every change to the
 * team, every member login and every request X2F refused a member.
 *
 * - Is the log intact? The API re-computes the hash chain (`GET /v1/team/log/integrity`). The
 *   owner copies the latest fingerprint to keep outside X2F and can paste a saved one back to
 *   check nothing before it changed.
 * - Last 30 days: one card per member (work, logins, refusals, changes made to them), each with a
 *   one-tap filter.
 * - Filter by member, kind (work, team changes, logins and refusals), action, trade code and dates;
 *   newest first, paged with "Show older entries".
 * - Each entry opens to its details (amount, offer terms, boxes added and removed, limits before and
 *   after, the device, what was refused and why) and its fingerprint.
 * - Download CSV or JSON of what the filters match (the JSON carries every seal, to re-check offline).
 *   The file is fetched through the app's client with the session (`teamLogExport`) and saved from
 *   an object URL. The check and the download each have an hourly budget per account (429
 *   `slow-down` with `retryAfterSeconds`, shown as the time to try again).
 *
 * A member holding "See the team log" sees only their own entries here, with no integrity, summary
 * or download (the API enforces it). Kit parts and existing classes only (NEEDS_DESIGN_TEAM).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  teamLogExportPath,
  AuthApiError,
  type TeamLogCategory,
  type TeamLogEntry,
  type TeamLogFilter,
  type TeamLogIntegrity,
  type TeamLogMemberSummary,
} from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { Checkbox } from '../../ui/Checkbox.js';
import { Disclosure } from '../../ui/Disclosure.js';
import { Facts } from '../../ui/Facts.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { authApi } from '../auth/authApi.js';
import { OwnerOnly } from './OwnerOnly.js';
import { useSession } from '../../session/useSession.js';
import { fetchCatalogue, type Catalogue } from './teamApi.js';
import { TEAM_PATH } from './teamCopy.js';
import { CATEGORY_WORDS, LOG_WORDS, TEAM_LOG_COPY as C, logFacts, logSentence } from './teamLogCopy.js';
import '../screens.css';

const CATEGORIES: readonly TeamLogCategory[] = ['work', 'team', 'access'];
const TRADE_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const FINGERPRINT = /^#?([1-9][0-9]{0,18}):([0-9a-fA-F]{64})$/;

/** The form's state: what the owner picked, before Apply. */
interface Draft {
  member: string;
  categories: TeamLogCategory[];
  action: string;
  trade: string;
  from: string;
  to: string;
}

const EMPTY: Draft = { member: '', categories: [], action: '', trade: '', from: '', to: '' };

/** The API filter a draft asks for; null when the trade code is malformed. A date's "until" includes that whole day. */
export function filterOfDraft(d: Draft): TeamLogFilter | null {
  const trade = d.trade.trim().toUpperCase();
  if (trade !== '' && !TRADE_CODE.test(trade)) return null;
  const day = (s: string, plus: number) => new Date(new Date(`${s}T00:00:00`).getTime() + plus).toISOString();
  return {
    ...(d.member !== '' ? { members: [d.member] } : {}),
    ...(d.categories.length > 0 ? { categories: d.categories } : {}),
    ...(d.action !== '' ? { actions: [d.action] } : {}),
    ...(trade !== '' ? { trade } : {}),
    ...(d.from !== '' ? { from: day(d.from, 0) } : {}),
    ...(d.to !== '' ? { to: day(d.to, 86_400_000) } : {}),
  };
}

/** For a 429 `slow-down`: the moment to try again (ISO), else null. */
export function retryAt(e: unknown, now: Date): string | null {
  if (!(e instanceof AuthApiError) || e.status !== 429) return null;
  const s = typeof e.retryAfterSeconds === 'number' && e.retryAfterSeconds > 0 ? e.retryAfterSeconds : 60;
  return new Date(now.getTime() + s * 1000).toISOString();
}

/** "#12:ab…" as the owner pasted it, or null. */
export function parseFingerprint(s: string): { id: string; hash: string } | null {
  const m = FINGERPRINT.exec(s.trim());
  return m === null ? null : { id: m[1]!, hash: m[2]!.toLowerCase() };
}

/** The account owner's alone (owner's choice, 26 Nov 2026): a member gets the owner-only refusal. */
export function TeamLog() {
  return (
    <OwnerOnly screen="team-log">
      <OwnersTeamLog />
    </OwnerOnly>
  );
}

function OwnersTeamLog() {
  const session = useSession();
  const ready = session.status === 'signed-in';
  const [entries, setEntries] = useState<TeamLogEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'load-failed' | 'signed-out' | 'refused'>('loading');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [filter, setFilter] = useState<TeamLogFilter>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<TeamLogIntegrity | null>(null);
  const [summary, setSummary] = useState<TeamLogMemberSummary[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [kept, setKept] = useState('');
  const [keptResult, setKeptResult] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [busy, setBusy] = useState(false);

  const boxLabel = useMemo(() => {
    const labels = new Map<string, string>();
    for (const g of catalogue?.groups ?? []) for (const a of g.abilities) labels.set(a.id, a.label);
    return (id: string) => labels.get(id) ?? id;
  }, [catalogue]);

  const load = useCallback(async (f: TeamLogFilter) => {
    setState('loading');
    try {
      const page = await authApi.teamLog(f);
      setEntries(page.entries);
      setNext(page.next);
      setState('ready');
    } catch (e) {
      if (e instanceof AuthApiError && e.status === 401) setState('signed-out');
      else if (e instanceof AuthApiError && e.status === 403) setState('refused');
      else setState('load-failed');
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void load(filter);
  }, [ready, filter, load]);

  // The owner's cards: the chain check and the 30-day summary. A member gets neither.
  useEffect(() => {
    if (!ready) return;
    authApi.teamLogIntegrity().then(setIntegrity, () => undefined);
    authApi.teamLogSummary(30).then((s) => setSummary(s.members), () => undefined);
  }, [ready]);

  useEffect(() => {
    const ctl = new AbortController();
    fetchCatalogue(ctl.signal).then(setCatalogue, () => undefined);
    return () => ctl.abort();
  }, []);

  const more = async () => {
    if (next === null || busy) return;
    setBusy(true);
    try {
      const page = await authApi.teamLog({ ...filter, before: next });
      setEntries((e) => [...(e ?? []), ...page.entries]);
      setNext(page.next);
    } catch {
      setState('load-failed');
    } finally {
      setBusy(false);
    }
  };

  const apply = (d: Draft) => {
    const f = filterOfDraft(d);
    if (f === null) {
      setFormError(C.tradeBad);
      return;
    }
    setFormError(null);
    setFilter(f);
  };

  const onlyMember = (id: string) => {
    const d = { ...EMPTY, member: id };
    setDraft(d);
    apply(d);
  };

  const copyFingerprint = () => {
    if (integrity?.head == null) return;
    void navigator.clipboard?.writeText(C.fingerprint(integrity.head.id, integrity.head.hash)).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  const checkKept = async () => {
    const fp = parseFingerprint(kept);
    if (fp === null) {
      setKeptResult(C.checkBad);
      return;
    }
    try {
      const r = await authApi.teamLogIntegrity(fp);
      setKeptResult(r.fingerprint?.matches === true ? C.matches : C.noMatch);
    } catch (e) {
      const at = retryAt(e, new Date());
      setKeptResult(at === null ? C.loadFailed : C.slowDown(at));
    }
  };

  // Everyone the member filter can name: the summary's members (removed ones too).
  const who = summary ?? [];
  const actions = Object.keys(LOG_WORDS).filter((a) => !a.startsWith('hold-'));

  return (
    <main className="x2f-screen" data-screen="team-log">
      <Link className="x2f-link" to={TEAM_PATH} data-part="team-log-back">
        {C.back}
      </Link>
      <h1 className="x2f-screen__title">{C.title}</h1>
      <p className="x2f-note">{C.intro}</p>

      {state === 'signed-out' ? <p className="x2f-note">{C.loadFailed}</p> : null}
      {state === 'refused' ? (
        <p className="x2f-error" role="alert" data-part="team-log-refused">
          {C.loadFailed}
        </p>
      ) : null}
      {state === 'load-failed' ? (
        <p className="x2f-error" role="alert">
          {C.loadFailed}
        </p>
      ) : null}

      {integrity !== null ? (
        <section className="x2f-card" data-part="team-log-integrity" aria-labelledby="team-log-integrity-h">
          <h2 className="x2f-card__title" id="team-log-integrity-h">
            {C.integrityTitle}
          </h2>
          {integrity.ok ? (
            <StatusChip tone="escrow" icon="check" label={C.intact(integrity.entries)} />
          ) : (
            <StatusChip tone="danger" icon="alert" label={C.broken(integrity.brokenAt ?? '?')} />
          )}
          {integrity.head !== null ? (
            <>
              <p className="x2f-note">{C.fingerprintIntro}</p>
              {/* A read-only field: the 64-character fingerprint scrolls inside it instead of widening the page. */}
              <input
                className="x2f-input x2f-digits"
                readOnly
                aria-label={C.copyFingerprint}
                value={C.fingerprint(integrity.head.id, integrity.head.hash)}
                data-part="team-log-fingerprint"
              />
              <Button variant="secondary" onClick={copyFingerprint} data-part="copy-fingerprint">
                {copied ? C.copied : C.copyFingerprint}
              </Button>
            </>
          ) : null}
          <div className="x2f-field">
            <label className="x2f-label" htmlFor="team-log-kept">
              {C.checkLabel}
            </label>
            <input className="x2f-input" id="team-log-kept" value={kept} onChange={(e) => setKept(e.target.value)} placeholder="#123:9f2c…" spellCheck={false} />
            <p className="x2f-note">{C.checkHint}</p>
          </div>
          <Button variant="quiet" onClick={() => void checkKept()} data-part="check-fingerprint">
            {C.checkButton}
          </Button>
          {keptResult !== null ? (
            <p className="x2f-note" role="status" data-part="fingerprint-result">
              {keptResult}
            </p>
          ) : null}
        </section>
      ) : null}

      {summary !== null ? (
        <section className="x2f-card" data-part="team-log-summary" aria-labelledby="team-log-summary-h">
          <h2 className="x2f-card__title" id="team-log-summary-h">
            {C.summaryTitle}
          </h2>
          {summary.length === 0 ? <p className="x2f-note">{C.summaryEmpty}</p> : null}
          <ul className="x2f-list">
            {summary.map((s) => (
              <li className="x2f-list__row" key={s.memberId} data-member={s.name}>
                <span className="x2f-list__label">
                  <span data-username="">{s.name}</span> · {C.status[s.status]}
                  <br />
                  <span className="x2f-list__time">{C.summaryLine(s)}</span>
                  <br />
                  <span className="x2f-list__time">{C.lastSeen(s.lastActionAt, s.lastLoginAt)}</span>
                </span>
                <Button variant="quiet" onClick={() => onlyMember(s.memberId)} data-part="summary-filter">
                  {C.showOnly(s.name)}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="x2f-card" data-part="team-log-filters" aria-labelledby="team-log-filters-h">
        <h2 className="x2f-card__title" id="team-log-filters-h">
          {C.filtersTitle}
        </h2>
          <div className="x2f-field">
            <label className="x2f-label" htmlFor="team-log-who">
              {C.who}
            </label>
            <select className="x2f-input" id="team-log-who" value={draft.member} onChange={(e) => setDraft({ ...draft, member: e.target.value })} data-part="filter-member">
              <option value="">{C.everyone}</option>
              {who.map((w) => (
                <option key={w.memberId} value={w.memberId}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        <fieldset className="x2f-field">
          <legend className="x2f-label">{C.kinds}</legend>
          {CATEGORIES.map((c) => (
            <label key={c} className="x2f-check">
              <Checkbox
                checked={draft.categories.includes(c)}
                onChange={(on) => setDraft({ ...draft, categories: on ? [...draft.categories, c] : draft.categories.filter((x) => x !== c) })}
                data-part={`filter-${c}`}
              />
              {CATEGORY_WORDS[c]}
            </label>
          ))}
        </fieldset>
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="team-log-action">
            {C.action}
          </label>
          <select className="x2f-input" id="team-log-action" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} data-part="filter-action">
            <option value="">{C.anyAction}</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {LOG_WORDS[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="team-log-trade">
            {C.trade}
          </label>
          <input className="x2f-input" id="team-log-trade" value={draft.trade} onChange={(e) => setDraft({ ...draft, trade: e.target.value })} spellCheck={false} data-part="filter-trade" />
          <p className="x2f-note">{C.tradeHint}</p>
        </div>
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="team-log-from">
            {C.from}
          </label>
          <input className="x2f-input" id="team-log-from" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} data-part="filter-from" />
        </div>
        <div className="x2f-field">
          <label className="x2f-label" htmlFor="team-log-to">
            {C.to}
          </label>
          <input className="x2f-input" id="team-log-to" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} data-part="filter-to" />
        </div>
        {formError !== null ? (
          <p className="x2f-error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button variant="secondary" onClick={() => apply(draft)} data-part="apply-filters">
          {C.apply}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            setDraft(EMPTY);
            apply(EMPTY);
          }}
          data-part="clear-filters"
        >
          {C.clear}
        </Button>
      </section>

      <section className="x2f-card" data-part="team-log-list" aria-labelledby="team-log-list-h" aria-busy={state === 'loading'}>
        <h2 className="x2f-card__title" id="team-log-list-h">
          {C.title}
        </h2>
        {state === 'loading' && entries === null ? <p className="x2f-note">{C.loading}</p> : null}
        {entries !== null && entries.length === 0 ? <p className="x2f-note">{C.empty}</p> : null}
        <ul className="x2f-list" data-part="team-log-entries">
          {(entries ?? []).map((e) => (
            <li className="x2f-list__row" key={e.id} data-action={e.action} data-category={e.category}>
              <Disclosure summary={logSentence(e)} note={CATEGORY_WORDS[e.category]} part="team-log-entry">
                {(id) => (
                  <div id={id}>
                    <Facts layout="rows" rows={logFacts(e, boxLabel).map(([key, value]) => ({ key, value, mono: key === 'Fingerprint' || key === 'Trade' }))} />
                  </div>
                )}
              </Disclosure>
            </li>
          ))}
        </ul>
        {next !== null ? (
          <Button variant="quiet" aria-disabled={busy} onClick={() => void more()} data-part="team-log-more">
            {C.more}
          </Button>
        ) : null}
      </section>

        <section className="x2f-card" data-part="team-log-export" aria-labelledby="team-log-export-h">
          <h2 className="x2f-card__title" id="team-log-export-h">
            {C.exportTitle}
          </h2>
          <p className="x2f-note">{C.exportIntro}</p>
          {/* Plain links: the browser sends the session cookie and saves the attachment itself (no Blob URL: proof-render tripwire). */}
          <a className="x2f-button x2f-button--secondary" href={teamLogExportPath(filter, 'csv')} download data-part="export-csv">
            {C.exportCsv}
          </a>
          <a className="x2f-button x2f-button--secondary" href={teamLogExportPath(filter, 'json')} download data-part="export-json">
            {C.exportJson}
          </a>
        </section>
    </main>
  );
}

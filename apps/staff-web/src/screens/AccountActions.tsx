import { banTermFor, can, type BanReasonCode, type BanRule, type BanTermChoice, type KeyTapIntent, type StaffRole } from '@x2f/staff';
import { useEffect, useId, useState } from 'react';
import {
  accountBans,
  codeOf,
  endHold,
  extendHold,
  liftBan,
  placeBan,
  serverNow,
  type AccountBans,
  type BanKind,
  type LookedUpAccount,
  type StaffBan,
} from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { Button, CantDoThat, ChoiceGroup, Notice, Sheet } from '../ui/kit.js';
import { utcMinuteText } from './staffFormat.js';
import { useMe } from '../ui/StaffShell.js';
import '../ui/staff.css';

/**
 * An account's card and its actions (spec 6.6 "Account actions", Plan 4 Task 27), shared by the
 * Accounts page and ModCase's Account actions card. No board draws any of it: DESIGN not drawn,
 * DESIGNER-REVIEW; every sentence is COPY-UNSIGNED.
 *
 * What it shows: the reputation a case's trader card shows, and the status (the bans in force, a
 * running account hold, a dispute freeze, a lien). What it offers follows the API's perms exactly,
 * and the API checks every call again:
 * - `accounts.freeze` reads the ban history; `accounts.ban` places a ban and `accounts.unban` lifts one
 *   (owner 26 Nov 2026: the owner, or a senior moderator ticked for each). Was: `accounts.ban`: the ban history with staff notes, a ban
 *   (trade or site, a rule from the list, an end or Permanent as D-017 allows for this offence,
 *   an optional staff note) and lifting a ban in force; each a security-key tap
 *   (`ban-account`, `lift-ban`) whose dialog says exactly what happens.
 * - `accounts.freeze` (the same roles): extending or ending a running account hold, each after a
 *   confirm sheet that says exactly what happens (the API takes no tap for them).
 * A role without the perm sees the status only.
 */

/** The general reason a ban shows the trader (apps/api's BAN_REASON_CODES; the trader app words its own). COPY-UNSIGNED */
export const REASON_WORDS: Readonly<Record<BanReasonCode, string>> = {
  terms: 'Breaking the Terms of Service',
  'trade-problems': 'Problems in trades',
  abuse: 'Abuse of other traders',
  'account-security': 'Account security',
};

/** Why an account hold runs (apps/api auth/hold.ts HoldReason). COPY-UNSIGNED */
const HOLD_WORDS: Readonly<Record<string, string>> = {
  'recovery-code': 'a login with a recovery code',
  'weak-change': 'a security change from a weaker login',
  'weak-new-device': 'a login on a new device',
  'weak-backup-login': 'a backup login',
};

/** The ban lengths offered (whole days; the API takes any end after now). */
export const BAN_DAYS = [1, 3, 7, 30, 90, 365] as const;
/** The hold extensions offered, from the hold's current end (the API caps a hold at 30 days from now). */
export const HOLD_EXTEND_DAYS = [1, 3, 7] as const;
const DAY = 86_400_000;
const HOLD_MAX_AHEAD = 30 * DAY;
export const BAN_NOTE_MAX = 500;

const daysText = (n: number) => (n === 1 ? '1 day' : `${n} days`);
/**
 * Owner, 28 Nov 2026: the three ban tiers, by the ban's kind and end (the API has no field of its
 * own for them): a trade ban, timed or not, is a "Trade ban"; a timed site ban a "Suspension"; a
 * site ban with no end a "Lifetime ban".
 */
export function banTierWords(kind: BanKind, until: string | null): 'Trade ban' | 'Suspension' | 'Lifetime ban' {
  if (kind === 'trade') return 'Trade ban';
  return until === null ? 'Lifetime ban' : 'Suspension';
}

/** A kind before its end is picked (the ban form, a standing ban of that kind). */
export const KIND_WORDS: Readonly<Record<BanKind, string>> = { trade: 'Trade ban', site: 'Suspension or lifetime ban' };

/** A ban's end as the API takes it: an exact ISO instant with milliseconds, `days` from now. */
export function banUntil(days: number, now: Date): string {
  return new Date(now.getTime() + days * DAY).toISOString();
}

/** A hold extension's new end, or null when it would pass the API's 30-day cap. */
export function holdExtendUntil(currentEnd: string, days: number, now: Date): string | null {
  const t = Date.parse(currentEnd) + days * DAY;
  return t > now.getTime() + HOLD_MAX_AHEAD ? null : new Date(t).toISOString();
}

const endText = (until: string | null) => (until === null ? 'Permanent' : `until ${utcMinuteText(until)}`);

/** One line per status entry, in the card. */
export function statusLines(a: LookedUpAccount): string[] {
  const s = a.status;
  const out: string[] = [];
  for (const b of s.bans) out.push(`${banTierWords(b.kind, b.until)}, ${endText(b.until)}: ${REASON_WORDS[b.reasonCode] ?? b.reasonCode}`);
  if (s.hold !== null) out.push(`Account hold until ${utcMinuteText(s.hold.until)}, after ${HOLD_WORDS[s.hold.reason] ?? 'a security event'}`);
  if (s.frozen) out.push('Frozen in a dispute');
  if (s.lien) out.push('Lien: until it is repaid, what they receive in their trades goes to the person owed');
  return out;
}

/**
 * Exactly what a ban does, for its tap dialog (apps/api staff/bans.ts and banState.ts): a trade ban
 * stops new trades and offers, open trades finish; a site ban leaves the person only the ban notice
 * and their unfinished trades, and ends their open streams; a permanent site ban also puts their
 * names and keys on the ban list.
 */
export function banBody(name: string, kind: BanKind, rule: BanRule, until: string | null): string {
  const end = until === null ? 'for good' : `until ${utcMinuteText(until)}`;
  const shown = `${name} sees the general reason "${REASON_WORDS[rule.reasonCode]}" and ${until === null ? '"Permanent"' : 'the end'}, never the rule or your note.`;
  const auto = until === null ? 'Only a senior moderator or the owner lifting it ends it.' : 'It ends by itself at that time.';
  if (kind === 'trade') {
    // not-a-refusal: says what the ban will do to the trader, to the staff member placing it.
    return `${name} can't post or take offers ${end}. Trades already open still finish. ${shown} ${auto} The ban is written to the activity log.`;
  }
  // not-a-refusal: says what a permanent site ban does, to the staff member placing it.
  const list = until === null ? ` Their names and keys also go on the ban list, so they can't sign up again with them.` : '';
  // not-a-refusal: says what the ban will do to the trader, to the staff member placing it.
  return `${name} is shut out of X2F ${end}: after logging in they see only the ban notice with the moderator contact link, and can still finish trades that are open. Their open pages are signed out now.${list} ${shown} ${auto} The ban is written to the activity log.`;
}

type Tap = { intent: KeyTapIntent; title: string; body: string; labels: Record<string, string>; run: (tapId: string) => Promise<void> };
type Confirm = { title: string; body: string; action: string; danger: boolean; run: (jabber: boolean) => Promise<void>; jabber?: boolean };

export function AccountCard({ account: a, role, onChanged }: { account: LookedUpAccount; role: StaffRole; onChanged: () => Promise<void> }) {
  const grants = useMe()?.grants ?? [];
  // Owner 26 Nov 2026: placing and lifting a ban are boxes per senior moderator; the history reads with the hold perm.
  const mayBan = can(role, 'accounts.ban', grants);
  const mayLift = can(role, 'accounts.unban', grants);
  const mayHold = can(role, 'accounts.freeze');
  const mayReadBans = mayHold || mayBan;
  const [bans, setBans] = useState<AccountBans | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [tap, setTap] = useState<Tap | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [banning, setBanning] = useState(false);
  const [extending, setExtending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmJabber, setConfirmJabber] = useState(false);
  const name = a.displayName;

  const loadBans = async () => {
    if (!mayReadBans) return;
    try {
      setBans(await accountBans(a.accountId));
    } catch (e) {
      setFault(faultText(e, "This account's bans could not be loaded just now. Reload to try again."));
    }
  };
  useEffect(() => {
    void loadBans();
  }, [a.accountId, mayReadBans]);

  /** Runs an action; a refusal is CantDoThat, a known changed state or anything else a fault. Then reads again. */
  const act = async (f: () => Promise<unknown>, ok: string, known: (code: string | null) => string): Promise<void> => {
    setBusy(true);
    setFault(null);
    setDone(null);
    try {
      await f();
      setDone(ok);
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else setFault(known(codeOf(e)) || faultText(e, 'That did not go through just now. Try again.'));
    } finally {
      setBusy(false);
      await loadBans();
      await onChanged();
    }
  };

  const askLift = (b: StaffBan) =>
    setTap({
      intent: { kind: 'lift-ban', accountId: a.accountId, banId: b.id },
      title: `Lift the ${banTierWords(b.kind, b.until).toLowerCase()} on ${name}`,
      body:
        b.kind === 'site' && b.permanent
          ? `The lifetime ban on ${name} ends now: they can log in and use X2F again, and their names and keys come off the ban list. The ban stays in their history and counts as an offence. The lift is written to the activity log.`
          : `The ${banTierWords(b.kind, b.until).toLowerCase()} on ${name} (${endText(b.until)}) ends now and the account works again. The ban stays in their history and counts as an offence. The lift is written to the activity log.`,
      labels: { accountId: name, banId: `the ${banTierWords(b.kind, b.until).toLowerCase()} shown` },
      run: (tapId) =>
        act(() => liftBan(a.accountId, b.id, tapId), `The ${banTierWords(b.kind, b.until).toLowerCase()} on ${name} is lifted and logged.`, (c) =>
          // not-a-refusal: the ban ended or was lifted meanwhile, a changed state.
          c === 'wrong-state' ? 'This ban is no longer in force. The list is up to date now.' : c === 'tap-invalid' ? 'The tap did not match this lift. Try again.' : '',
        ),
    });

  const askBan = (p: { kind: BanKind; rule: BanRule; until: string | null; note: string }) => {
    setBanning(false);
    const banId = crypto.randomUUID();
    const tier = banTierWords(p.kind, p.until);
    setTap({
      intent: { kind: 'ban-account', accountId: a.accountId, banId, banKind: p.kind, ruleId: p.rule.id, until: p.until },
      title: `${tier} for ${name}${p.until !== null ? ` until ${utcMinuteText(p.until)}` : tier === 'Trade ban' ? ', for good' : ''}`,
      body: banBody(name, p.kind, p.rule, p.until),
      labels: { accountId: name, banId: 'this new ban', banKind: tier, ruleId: p.rule.label, ...(p.until !== null ? { until: utcMinuteText(p.until) } : {}) },
      run: (tapId) =>
        act(
          () => placeBan(a.accountId, { banId, kind: p.kind, ruleId: p.rule.id, until: p.until, ...(p.note.trim() !== '' ? { note: p.note.trim() } : {}), tapId }),
          tier === 'Trade ban' ? `${name} is banned from trading ${endText(p.until)}. Logged.`
            : tier === 'Suspension' ? `${name} is suspended ${endText(p.until)}. Logged.`
            : `${name} has a lifetime ban. Logged.`,
          (c) =>
            // not-a-refusal: a ban of that kind was placed meanwhile, a changed state.
            c === 'already-banned' ? `${name} already has a ${KIND_WORDS[p.kind].toLowerCase()} in force. The list is up to date now.`
              // not-a-refusal: the account's offence count changed meanwhile, so the term must be picked again.
              : c === 'lifetime-required' || c === 'lifetime-not-allowed' ? "This account's ban history changed meanwhile, so the end must be picked again. Start the ban again."
              : c === 'tap-invalid' ? 'The tap did not match this ban. Try again.'
              // not-a-refusal: an input fault, the end passed while the dialog was open.
              : c === 'bad-request' ? 'The end time had already passed. Start the ban again.'
              : '',
        ),
    });
  };

  const hold = a.status.hold;
  const askEndHold = () =>
    setConfirm({
      title: `End the account hold on ${name}`,
      body: `The hold ends now instead of at ${hold !== null ? utcMinuteText(hold.until) : 'its end'}. ${name} can trade again and the trades waiting on the hold resume. A security change that was waiting for the hold to end is dropped, not applied. ${name} is told staff ended the hold. The end is written to the activity log.`,
      action: 'End the hold',
      danger: false,
      jabber: true,
      run: async (jabber) => {
        const via = jabber ? ('secure-jabber' as const) : null;
        await act(() => endHold(a.accountId, via), `The hold on ${name} has ended. Logged.`, (c) =>
          // not-a-refusal: the hold ended meanwhile, a changed state.
          c === 'not-found' ? `${name} has no hold running any more.`
            // not-a-refusal: the claim about the Jabber channel does not check out, so the hold stays; an input fault.
            : c === 'no-secure-jabber' ? `X2F has no secure Jabber address for ${name} proven before the hold began, so the hold stays. End it without that box ticked if you vetted them another way.`
            : '',
        );
      },
    });
  const askExtend = (until: string) => {
    setExtending(false);
    setConfirm({
      title: `Extend the account hold on ${name}`,
      // not-a-refusal: says what the hold does, to the staff member extending it.
      body: `The hold now ends at ${utcMinuteText(until)} instead of ${hold !== null ? utcMinuteText(hold.until) : 'its current end'}. Until then ${name} can't trade or change their security, and the trades waiting on the hold stay paused. ${name} is told staff extended the hold. The change is written to the activity log.`,
      action: 'Extend the hold',
      danger: true,
      run: () =>
        act(() => extendHold(a.accountId, until), `The hold on ${name} now ends at ${utcMinuteText(until)}. Logged.`, (c) =>
          // not-a-refusal: the hold ended meanwhile, a changed state.
          c === 'not-found' ? `${name} has no hold running any more.` : c === 'bad-request' ? 'That end is too far ahead or already passed. Pick again.' : '',
        ),
    });
  };

  const lines = statusLines(a);
  const standing = new Set(a.status.bans.map((b) => b.kind));
  const free: BanKind[] = (['trade', 'site'] as const).filter((k) => !standing.has(k));

  return (
    <section className="x2f-card x2f-stack" data-part="account-card" data-account={a.accountId}>
      {a.side !== null ? <p className="x2f-staff-eyebrow">{a.side === 'buyer' ? 'Buyer' : 'Seller'}</p> : null}
      <h2 className="x2f-h2" data-username>
        {name}
      </h2>
      <p className="x2f-staff-hint" data-part="account-reputation">
        {`${a.completedTrades} trades · ${a.positivePct === null ? 'no ratings yet' : `${a.positivePct}% positive`} · Disputes: ${a.disputes.won} won, ${a.disputes.lost} lost`}
      </p>
      <div data-part="account-status">
        {lines.length === 0 ? (
          <p>No ban, hold, freeze or lien.</p>
        ) : (
          <ul>
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </div>

      {mayReadBans ? (
        <div className="x2f-stack" data-part="account-bans">
          <h3 className="x2f-staff-eyebrow">Bans</h3>
          {bans === null ? null : bans.bans.length === 0 ? (
            <p className="x2f-staff-hint">No bans so far.</p>
          ) : (
            <ul className="x2f-stack" data-part="ban-history">
              {bans.bans.map((b) => (
                <li key={b.id} data-ban={b.id} data-active={b.active ? 'true' : 'false'}>
                  <span>{`${banTierWords(b.kind, b.until)}, ${endText(b.until)}: ${bans.rules.find((r) => r.id === b.ruleId)?.label ?? b.ruleId}. Placed ${utcMinuteText(b.createdAt)}.`}</span>
                  {b.liftedAt !== null ? <span className="x2f-staff-hint">{` Lifted ${utcMinuteText(b.liftedAt)}.`}</span> : b.endedAt !== null || !b.active ? <span className="x2f-staff-hint"> Ended.</span> : null}
                  {b.note !== null ? <span className="x2f-staff-hint">{` Staff note: ${b.note}`}</span> : null}
                  {b.active && mayLift ? (
                    <Button variant="secondary" disabled={busy} onClick={() => askLift(b)}>
                      {`Lift this ${banTierWords(b.kind, b.until).toLowerCase()}`}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {mayBan && bans !== null && free.length > 0 ? (
            <Button variant="danger-outline" disabled={busy} onClick={() => setBanning(true)}>
              {`Ban ${name}`}
            </Button>
          ) : null}
        </div>
      ) : null}

      {mayHold && hold !== null ? (
        <div className="x2f-stack" data-part="account-hold">
          <h3 className="x2f-staff-eyebrow">Account hold</h3>
          <Button variant="secondary" disabled={busy} onClick={() => setExtending(true)}>
            Extend the hold
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => { setConfirmJabber(false); askEndHold(); }}>
            End the hold
          </Button>
        </div>
      ) : null}

      {done !== null ? (
        <p className="x2f-staff-ok" role="status" data-part="account-done">
          {done}
        </p>
      ) : null}
      {fault !== null ? (
        <Notice tone="danger" data-part="account-fault">
          {fault}
        </Notice>
      ) : null}

      {banning && bans !== null ? <BanSheet name={name} bans={bans} kinds={free} onCancel={() => setBanning(false)} onReview={askBan} /> : null}
      {extending && hold !== null ? <ExtendSheet name={name} end={hold.until} onCancel={() => setExtending(false)} onPick={askExtend} /> : null}
      {confirm !== null ? (
        <Sheet open title={confirm.title} wide="dialog" onClose={() => setConfirm(null)}>
          <div className="x2f-stack" data-part="account-confirm">
            <p>{confirm.body}</p>
            {confirm.jabber ? (
              <label className="x2f-check">
                <input type="checkbox" data-part="hold-jabber" checked={confirmJabber} onChange={(e) => setConfirmJabber(e.target.checked)} />
                <span>I reached the account holder on the account's own secure Jabber address</span>
              </label>
            ) : null}
            <Button
              variant={confirm.danger ? 'danger-outline' : 'secondary'}
              disabled={busy}
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                void c.run(c.jabber === true && confirmJabber);
              }}
            >
              {confirm.action}
            </Button>
            <Button variant="quiet" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </Sheet>
      ) : null}
      {tap !== null ? (
        <KeyTapDialog
          intent={tap.intent}
          title={tap.title}
          body={tap.body}
          labels={tap.labels}
          onCancel={() => setTap(null)}
          onDone={(tapId) => {
            const t = tap;
            setTap(null);
            void t.run(tapId);
          }}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </section>
  );
}

/** The term choices D-017 leaves for this rule and offence. */
function termOptions(choice: BanTermChoice): Array<{ value: string; label: string }> {
  const lengths = BAN_DAYS.map((d) => ({ value: String(d), label: daysText(d) }));
  if (choice === 'lifetime') return [{ value: 'permanent', label: 'Permanent' }];
  if (choice === 'length-or-lifetime') return [...lengths, { value: 'permanent', label: 'Permanent' }];
  return lengths;
}

/**
 * The ban form: kind, rule (the reason), length (where the rule and the offence count leave a
 * choice) and an optional staff note. "Review the ban" opens the tap dialog with exactly what
 * happens; nothing is placed before the tap.
 */
function BanSheet({ name, bans, kinds, onCancel, onReview }: {
  name: string;
  bans: AccountBans;
  kinds: BanKind[];
  onCancel: () => void;
  onReview: (p: { kind: BanKind; rule: BanRule; until: string | null; note: string }) => void;
}) {
  const kindId = useId();
  const ruleId = useId();
  const termId = useId();
  const noteId = useId();
  const [kind, setKind] = useState<BanKind | null>(kinds.length === 1 ? kinds[0]! : null);
  const [rule, setRule] = useState<string | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const r = bans.rules.find((x) => x.id === rule) ?? null;
  const choice = r !== null ? banTermFor(r.id, bans.priorOffences) : null;
  const options = choice !== null ? termOptions(choice) : [];
  const pickedTerm = choice === 'lifetime' ? 'permanent' : options.some((o) => o.value === term) ? term : null;
  const ready = kind !== null && r !== null && pickedTerm !== null && note.length <= BAN_NOTE_MAX;
  const offence = bans.priorOffences + 1;

  const review = () => {
    if (!ready || kind === null || r === null || pickedTerm === null) return;
    onReview({ kind, rule: r, until: pickedTerm === 'permanent' ? null : banUntil(Number(pickedTerm), serverNow()), note });
  };

  return (
    <Sheet open title={`Ban ${name}`} wide="dialog" onClose={onCancel}>
      <div className="x2f-stack" data-part="ban-form">
        <p className="x2f-staff-hint">{`This would be offence ${offence} for this account. From the third, every ban is permanent.`}</p>
        <p className="x2f-staff-eyebrow" id={kindId}>
          Kind
        </p>
        <ChoiceGroup
          look="card"
          labelledBy={kindId}
          value={kind}
          onChange={setKind}
          part="ban-kind"
          options={kinds.map((k) => ({
            value: k,
            label: KIND_WORDS[k],
            // not-a-refusal: describes what each kind of ban does, before any choice.
            note: k === 'trade' ? "Can't post or take offers. Open trades finish." : 'Shut out of X2F except for unfinished trades and the ban notice. With an end it is a suspension; Permanent makes it a lifetime ban.',
          }))}
        />
        <p className="x2f-staff-eyebrow" id={ruleId}>
          Reason (required)
        </p>
        <ChoiceGroup
          look="card"
          labelledBy={ruleId}
          value={rule}
          onChange={(v) => {
            setRule(v);
            setTerm(null);
          }}
          part="ban-rule"
          options={bans.rules.map((x) => ({ value: x.id, label: x.label, note: `The trader sees: ${REASON_WORDS[x.reasonCode]}` }))}
        />
        {choice !== null ? (
          <>
            <p className="x2f-staff-eyebrow" id={termId}>
              Length (required)
            </p>
            {choice === 'lifetime' ? (
              <p data-part="ban-term-lifetime">{`Permanent: this is offence ${offence} for this account.`}</p>
            ) : (
              <ChoiceGroup look="tile" labelledBy={termId} value={pickedTerm} onChange={setTerm} part="ban-term" options={options} />
            )}
            {pickedTerm !== null && pickedTerm !== 'permanent' ? (
              <p className="x2f-staff-hint">{`Ends at about ${utcMinuteText(banUntil(Number(pickedTerm), serverNow()))}; the exact time is fixed when you tap.`}</p>
            ) : null}
          </>
        ) : null}
        <div className="x2f-field">
          <label className="x2f-label" htmlFor={noteId}>
            Staff note (optional; staff only, never shown to the trader or logged)
          </label>
          <textarea id={noteId} className="x2f-textarea" rows={3} maxLength={BAN_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button variant="danger-outline" disabled={!ready} onClick={review}>
          Review the ban
        </Button>
        <p className="x2f-staff-hint">{ready ? 'Next you see exactly what happens, then tap your security key.' : 'Pick the kind, the reason and the length.'}</p>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

function ExtendSheet({ name, end, onCancel, onPick }: { name: string; end: string; onCancel: () => void; onPick: (until: string) => void }) {
  const headId = useId();
  const now = serverNow();
  const options = HOLD_EXTEND_DAYS.flatMap((d) => {
    const until = holdExtendUntil(end, d, now);
    return until === null ? [] : [{ value: until, label: `${daysText(d)} more`, note: `Until ${utcMinuteText(until)}` }];
  });
  const [pick, setPick] = useState<string | null>(null);
  return (
    <Sheet open title={`Extend the account hold on ${name}`} wide="dialog" onClose={onCancel}>
      <div className="x2f-stack" data-part="hold-extend">
        {/* not-a-refusal: the API's bound on an extension, explained before any choice. */}
        <p className="x2f-staff-hint">{`The hold now ends at ${utcMinuteText(end)}. A hold can run at most 30 days from now.`}</p>
        {options.length === 0 ? (
          // not-a-refusal: explains why no extension is offered (the API's 30-day cap), before any attempt.
          <p>The hold already ends close to 30 days from now, so it cannot be extended further.</p>
        ) : (
          <>
            <p className="x2f-staff-eyebrow" id={headId}>
              Extend by
            </p>
            <ChoiceGroup look="card" labelledBy={headId} value={pick} onChange={setPick} part="hold-days" options={options} />
          </>
        )}
        <Button variant="secondary" disabled={pick === null} onClick={() => pick !== null && onPick(pick)}>
          Review the extension
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

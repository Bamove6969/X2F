import type { KeyTapIntent } from '@x2f/staff';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  addPgpFinish,
  addPgpStart,
  endMySession,
  markMyAlertSeen,
  myAlerts,
  myMethods,
  mySessions,
  removeMethod,
  serverNow,
  type MethodEntry,
  type MethodType,
  type MyAlert,
  type MySession,
  type PgpChallenge,
  type Taps,
} from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, Notice, Sheet } from '../ui/kit.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { PageTitle, useMe } from '../ui/StaffShell.js';
import { lastActiveText, utcMinuteText } from './staffFormat.js';
import '../ui/staff.css';

/**
 * My security (lead re-review 6 Nov items 1 and 2: staff and the owner are refused on the trader
 * site, so their own account work is here; perm `self`, every role, one's own account only, from
 * apps/api/src/staff/account.ts). Three cards, as the trader app's Settings → Security, Devices and
 * Alerts screens lay them out, built from the staff app's own kit:
 *
 * - Login methods: each method with when it was added and last used. A PGP key, a security key or a
 *   passkey can be removed with a `remove-method` tap of one of the person's security keys (the
 *   owner taps both owner keys, owner G4); the API keeps the login rule (the owner's two keys, a
 *   moderator's PGP key and passkey) and says why when it refuses. A PGP key can be added: paste
 *   it, decrypt X2F's message, then an `add-pgp-key` tap bound to the fingerprint the API read
 *   (shown first, to compare with the PGP app). Security keys and passkeys are added through the
 *   owner (a reset link), which the card says.
 * - Sessions: every live session on both sites; any other one can be logged out (asked first; no
 *   tap, since it only takes power away). This session is marked and is logged out with Log out.
 * - Alerts: the newest 50, unseen first marked New. "Mark as seen" is the person's own act and is
 *   logged (lead review 7 Nov M1), so the page never marks them by itself.
 *
 * No board draws it (DESIGNER-REVIEW). Words: COPY-UNSIGNED (all of C).
 */
const C = {
  title: 'My security',
  lead: 'Your own login methods, where you are logged in, and security alerts. Changes to your login methods need a tap of your security key.',
  methods: {
    title: 'Login methods',
    type: {
      pgp: 'PGP key',
      'security-key': 'Security key',
      passkey: 'Passkey',
      totp: 'Authenticator app',
      'recovery-codes': 'Recovery codes',
    } satisfies Record<MethodType, string>,
    added: (at: string) => `Added ${utcMinuteText(at)}`,
    used: (at: string | null, now: Date) => (at === null ? 'Not used to log in yet' : `Last used ${lastActiveText(at, now).toLowerCase()}`),
    remove: 'Remove',
    removeLabel: (what: string) => `Remove ${what}`,
    removeTitle: 'Remove a login method',
    removeBody: 'Tap your security key to remove this login method. Your other sessions are logged out.',
    removed: 'Removed. Your other sessions were logged out.',
    addKeysNote: 'To add a security key or a passkey, ask the owner for a security reset link.',
    none: 'No login methods.',
  },
  pgp: {
    add: 'Add a PGP key',
    keyLabel: 'Your PGP public key',
    pasteWhole: 'Paste your whole public key, from -----BEGIN PGP PUBLIC KEY BLOCK----- to the end.',
    send: 'Send message',
    fingerprint: 'Fingerprint of this key',
    compare: 'Check it matches the fingerprint your PGP app shows for this key.',
    message: 'Decrypt this message in your PGP app',
    code: 'Code from the message',
    needCode: 'Paste the code from the decrypted message first.',
    tapAndAdd: 'Tap key and add',
    cancel: 'Cancel',
    tapTitle: 'Add this PGP key',
    tapBody: 'Tap your security key to add the PGP key with this fingerprint.',
    added: 'PGP key added.',
    keyFault: 'X2F could not read that key. Check that you pasted the public key, then try again.',
    codeFault: 'That code did not work. It may have expired: send a new message and try again.',
  },
  owner: {
    secondTitle: 'Tap your other owner key',
    secondBody: 'Changes to the owner account need both owner security keys. Tap the other one now.',
  },
  sessions: {
    title: 'Sessions',
    lead: 'Every place you are logged in, on the staff site and the trader site.',
    site: (s: string) => (s === 'staff' ? 'Staff site' : 'Trader site'),
    thisOne: 'This session',
    active: (at: string, now: Date) => `Active ${lastActiveText(at, now).toLowerCase()}`,
    since: (at: string) => `Logged in ${utcMinuteText(at)}`,
    logOut: 'Log out',
    logOutLabel: (device: string) => `Log out ${device}`,
    logOutOthers: 'Log out all other sessions',
    askOne: (device: string) => `Log out ${device}?`,
    askAll: (n: number) => (n === 1 ? 'Log out 1 other session?' : `Log out ${n} other sessions?`),
    askText: 'It is logged out right away. This session stays logged in.',
    confirm: 'Log out',
    keep: 'Keep logged in',
    done: 'Logged out.',
    none: 'Only this session is logged in.',
    fault: 'That session was not logged out. Try again.',
  },
  alerts: {
    title: 'Alerts',
    lead: 'Security events on your account, newest first.',
    fresh: 'New',
    seen: 'Mark as seen',
    seenLabel: (what: string) => `Mark ${what.toLowerCase()} as seen`,
    none: 'No alerts.',
    kind: {
      'new-login': 'New login',
      'recovery-login': 'Logged in with a backup',
      // not-a-refusal: an alert kind (a security throttle)
      'login-locked': 'Logins paused after too many tries',
      'login-blocked': 'A login was blocked',
      'login-method-added': 'A login method was added',
      'login-method-removed': 'A login method was removed',
      'sessions-ended': 'Other sessions were logged out',
      'staff-device-certified': 'A device was confirmed to read dispute chats',
      // Owner 26 Nov 2026 ("Pool first, auto-assign if untaken"). COPY-UNSIGNED
      'dispute-auto-assigned': 'Nobody took a dispute in time: it was assigned to you automatically',
      'dispute-unassigned-overdue': 'A dispute is still unassigned past its reply deadline',
    } as Readonly<Record<string, string>>,
    other: 'Security alert',
    on: (device: string) => `On ${device}`,
    count: (n: number) => (n === 1 ? '1 session' : `${n} sessions`),
  },
  loadFault: 'X2F could not load your security settings just now. Reload to try again.',
  fault: 'That did not work. Try again.',
} as const;

const REMOVABLE: readonly MethodType[] = ['pgp', 'security-key', 'passkey'];

class TapCancelled extends Error {
  constructor() {
    super('tap cancelled');
    this.name = 'TapCancelled';
  }
}

type TapAsk = { intent: KeyTapIntent; title: string; body: string; first: string | null; resolve: (t: Taps) => void; reject: (e: Error) => void };

/**
 * The taps a change of one's own login methods takes: one security-key tap, or for the owner a tap
 * by each owner key for the same intent (owner G4; the API refuses the same key twice).
 */
function useTaps(owner: boolean) {
  const [ask, setAsk] = useState<TapAsk | null>(null);
  const tapsFor = useCallback(
    (intent: KeyTapIntent, title: string, body: string) =>
      new Promise<Taps>((resolve, reject) => setAsk({ intent, title, body, first: null, resolve, reject })),
    [],
  );
  const ui =
    ask === null ? null : (
      <KeyTapDialog
        key={ask.first === null ? 'first' : 'second'}
        intent={ask.intent}
        title={ask.first === null ? ask.title : C.owner.secondTitle}
        body={ask.first === null ? ask.body : C.owner.secondBody}
        onDone={(tapId) => {
          if (owner && ask.first === null) {
            setAsk({ ...ask, first: tapId });
            return;
          }
          setAsk(null);
          ask.resolve(ask.first === null ? { tapId } : { tapId: ask.first, secondTapId: tapId });
        }}
        onCancel={() => {
          setAsk(null);
          ask.reject(new TapCancelled());
        }}
      />
    );
  return { tapsFor, ui };
}

const alertDetail = (a: MyAlert): string | null => {
  const d = (a.detail !== null && typeof a.detail === 'object' ? a.detail : {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d.method === 'string' && Object.hasOwn(C.methods.type, d.method)) parts.push(C.methods.type[d.method as MethodType]);
  if (typeof d.deviceLabel === 'string' && d.deviceLabel !== '') parts.push(C.alerts.on(d.deviceLabel));
  // Owner 26 Nov 2026: the dispute alerts name their trade (codeText's groups of four).
  if (typeof d.trade === 'string' && /^[0-9A-Z]{16}$/.test(d.trade)) parts.push(`Trade ${d.trade.replace(/(.{4})(?=.)/g, '$1-')}`);
  if (a.kind === 'sessions-ended' && typeof d.count === 'number' && Number.isInteger(d.count) && d.count >= 0) parts.push(C.alerts.count(d.count));
  return parts.length === 0 ? null : parts.join(' · ');
};

export function MySecurity() {
  const who = useMe();
  const owner = who?.role === 'owner';
  const { tapsFor, ui: tapUi } = useTaps(owner);
  const [methods, setMethods] = useState<MethodEntry[] | null>(null);
  const [sessions, setSessions] = useState<MySession[] | null>(null);
  const [alerts, setAlerts] = useState<MyAlert[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [askEnd, setAskEnd] = useState<{ ids: string[]; title: string } | null>(null);
  const now = serverNow();

  const load = useCallback(async () => {
    const [m, s, a] = await Promise.all([myMethods(), mySessions(), myAlerts()]);
    setMethods(m);
    setSessions(s);
    setAlerts(a);
  }, []);
  useEffect(() => {
    load().catch((e: unknown) => setFault(faultText(e, C.loadFault)));
  }, [load]);

  /** Runs one change; a refusal goes to CantDoThat, a cancelled tap says nothing. */
  const act = async (run: () => Promise<void>, done: string | null, fallback: string = C.fault) => {
    setBusy(true);
    setFault(null);
    setNote(null);
    try {
      await run();
      if (done !== null) setNote(done);
    } catch (e) {
      if (!(e instanceof TapCancelled)) {
        const r = refusalOf(e);
        if (r !== null) setRefusal(r);
        else setFault(faultText(e, fallback));
      }
    } finally {
      await load().catch(() => undefined);
      setBusy(false);
    }
  };

  const remove = (m: MethodEntry) =>
    void act(async () => {
      const type = m.type as 'pgp' | 'security-key' | 'passkey';
      const taps = await tapsFor({ kind: 'remove-method', methodType: type, methodId: m.id.toLowerCase() }, C.methods.removeTitle, C.methods.removeBody);
      await removeMethod(type, m.id, taps);
    }, C.methods.removed);

  const others = (sessions ?? []).filter((s) => !s.current);
  const endSessions = (ids: string[]) =>
    void act(async () => {
      for (const id of ids) await endMySession(id);
    }, C.sessions.done, C.sessions.fault);

  return (
    <section data-screen="my-security" className="x2f-staff-narrow">
      <PageTitle title={C.title}>
        <p className="x2f-staff-page__lead">{C.lead}</p>
      </PageTitle>
      {fault !== null ? (
        <Notice tone="danger" data-part="security-fault">
          {fault}
        </Notice>
      ) : null}
      {note !== null ? (
        <Notice tone="plain" data-part="security-note">
          {note}
        </Notice>
      ) : null}

      <section aria-label={C.methods.title} className="x2f-staff-card x2f-stack" data-part="methods">
        <h2 className="x2f-h2">{C.methods.title}</h2>
        {methods !== null && methods.length === 0 ? <p className="x2f-staff-hint">{C.methods.none}</p> : null}
        <ul className="x2f-stack x2f-staff-list" aria-label={C.methods.title}>
          {(methods ?? []).map((m) => {
            const what = `${C.methods.type[m.type]} ${m.label}`;
            return (
              <li key={`${m.type}:${m.id}`} className="x2f-staff-setting" data-part="method" data-method={m.type}>
                <span className="x2f-staff-setting__label">{C.methods.type[m.type]}</span>
                <span className="x2f-staff-setting__value">
                  <span data-mono="">{m.label}</span>
                  {REMOVABLE.includes(m.type) ? (
                    <Button variant="quiet" aria-label={C.methods.removeLabel(what)} disabled={busy} onClick={() => remove(m)}>
                      {C.methods.remove}
                    </Button>
                  ) : null}
                </span>
                <span className="x2f-staff-hint">{[m.createdAt !== null ? C.methods.added(m.createdAt) : null, C.methods.used(m.lastUsedAt, now)].filter(Boolean).join(' · ')}</span>
              </li>
            );
          })}
        </ul>
        <AddPgpKey busy={busy} tapsFor={tapsFor} onAdded={() => void act(async () => undefined, C.pgp.added)} />
        <span className="x2f-staff-hint">{C.methods.addKeysNote}</span>
      </section>

      <section aria-label={C.sessions.title} className="x2f-staff-card x2f-stack" data-part="sessions">
        <div className="x2f-stack">
          <h2 className="x2f-h2">{C.sessions.title}</h2>
          <span className="x2f-staff-hint">{C.sessions.lead}</span>
        </div>
        <ul className="x2f-stack x2f-staff-list" aria-label={C.sessions.title}>
          {(sessions ?? []).map((s) => (
            <li key={s.id} className="x2f-staff-setting" data-part="session" data-current={s.current ? '' : undefined}>
              <span className="x2f-staff-setting__label">{s.deviceLabel}</span>
              <span className="x2f-staff-setting__value">
                <span className="x2f-staff-hint">{[C.sessions.site(s.site), C.sessions.active(s.lastSeenAt, now), C.sessions.since(s.createdAt)].join(' · ')}</span>
                {s.current ? (
                  <strong data-part="this-session">{C.sessions.thisOne}</strong>
                ) : (
                  <Button variant="quiet" aria-label={C.sessions.logOutLabel(s.deviceLabel)} disabled={busy} onClick={() => setAskEnd({ ids: [s.id], title: C.sessions.askOne(s.deviceLabel) })}>
                    {C.sessions.logOut}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {sessions !== null && others.length === 0 ? <p className="x2f-staff-hint">{C.sessions.none}</p> : null}
        {others.length > 1 ? (
          <div>
            <Button variant="secondary" disabled={busy} onClick={() => setAskEnd({ ids: others.map((s) => s.id), title: C.sessions.askAll(others.length) })}>
              {C.sessions.logOutOthers}
            </Button>
          </div>
        ) : null}
      </section>

      <section aria-label={C.alerts.title} className="x2f-staff-card x2f-stack" data-part="alerts">
        <div className="x2f-stack">
          <h2 className="x2f-h2">{C.alerts.title}</h2>
          <span className="x2f-staff-hint">{C.alerts.lead}</span>
        </div>
        {alerts !== null && alerts.length === 0 ? <p className="x2f-staff-hint">{C.alerts.none}</p> : null}
        <ul className="x2f-stack x2f-staff-list" aria-label={C.alerts.title}>
          {(alerts ?? []).map((a) => {
            const what = C.alerts.kind[a.kind] ?? C.alerts.other;
            const detail = alertDetail(a);
            return (
              <li key={a.id} className="x2f-staff-setting" data-part="alert" data-seen={a.seenAt !== null ? '' : undefined}>
                <span className="x2f-staff-setting__label">
                  {what}
                  {a.seenAt === null ? (
                    <span className="x2f-staff-new" data-part="alert-new">
                      {C.alerts.fresh}
                    </span>
                  ) : null}
                </span>
                <span className="x2f-staff-setting__value">
                  <span className="x2f-staff-hint">{[utcMinuteText(a.createdAt), detail].filter(Boolean).join(' · ')}</span>
                  {a.seenAt === null ? (
                    <Button variant="quiet" aria-label={C.alerts.seenLabel(what)} disabled={busy} onClick={() => void act(() => markMyAlertSeen(a.id).then(() => undefined), null)}>
                      {C.alerts.seen}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {askEnd !== null ? (
        <Sheet open title={askEnd.title} wide="dialog" onClose={() => setAskEnd(null)}>
          <div className="x2f-stack" data-part="end-session-ask">
            <p>{C.sessions.askText}</p>
            <Button
              variant="danger-outline"
              onClick={() => {
                const ids = askEnd.ids;
                setAskEnd(null);
                endSessions(ids);
              }}
            >
              {C.sessions.confirm}
            </Button>
            <Button variant="quiet" onClick={() => setAskEnd(null)}>
              {C.sessions.keep}
            </Button>
          </div>
        </Sheet>
      ) : null}
      {tapUi}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </section>
  );
}

/**
 * Adding a PGP key: the key, X2F's message to it (with the fingerprint the API read, to compare),
 * the code, then the tap(s) bound to that fingerprint and the finish. The step's button is the
 * page's one primary action.
 */
function AddPgpKey({ busy, tapsFor, onAdded }: { busy: boolean; tapsFor: (i: KeyTapIntent, title: string, body: string) => Promise<Taps>; onAdded: () => void }) {
  const keyId = useId();
  const msgId = useId();
  const codeId = useId();
  const fpId = useId();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [challenge, setChallenge] = useState<(PgpChallenge & { fingerprint: string }) | null>(null);
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const reset = () => {
    setOpen(false);
    setKey('');
    setChallenge(null);
    setCode('');
    setFault(null);
  };
  const fail = (e: unknown, fallback: string) => {
    if (e instanceof TapCancelled) return;
    const r = refusalOf(e);
    if (r !== null) setRefusal(r);
    else setFault(faultText(e, fallback));
  };

  const send = async () => {
    if (!key.includes('-----BEGIN PGP')) {
      setFault(C.pgp.pasteWhole);
      return;
    }
    setWorking(true);
    setFault(null);
    try {
      setChallenge(await addPgpStart(key));
      setCode('');
    } catch (e) {
      fail(e, C.pgp.keyFault);
    } finally {
      if (live.current) setWorking(false);
    }
  };

  const add = async () => {
    if (challenge === null) return;
    if (code.trim() === '') {
      setFault(C.pgp.needCode);
      return;
    }
    setWorking(true);
    setFault(null);
    try {
      const taps = await tapsFor({ kind: 'add-pgp-key', fingerprint: challenge.fingerprint.toLowerCase() }, C.pgp.tapTitle, C.pgp.tapBody);
      await addPgpFinish({ challengeId: challenge.challengeId, code: code.trim(), ...taps });
      reset();
      onAdded();
    } catch (e) {
      fail(e, C.pgp.codeFault);
    } finally {
      if (live.current) setWorking(false);
    }
  };

  if (!open) {
    return (
      <div>
        <Button variant="primary" disabled={busy} onClick={() => setOpen(true)}>
          {C.pgp.add}
        </Button>
      </div>
    );
  }
  return (
    <div className="x2f-stack" data-part="add-pgp">
      {challenge === null ? (
        <>
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={keyId}>
              {C.pgp.keyLabel}
            </label>
            <textarea id={keyId} className="x2f-textarea" rows={6} spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div>
            <Button variant="primary" disabled={working} onClick={() => void send()}>
              {C.pgp.send}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="x2f-field">
            <span className="x2f-label" id={fpId}>
              {C.pgp.fingerprint}
            </span>
            <code className="x2f-staff-fingerprint" aria-labelledby={fpId} data-part="add-pgp-fingerprint">
              {challenge.fingerprint.toUpperCase()}
            </code>
            <span className="x2f-staff-hint">{C.pgp.compare}</span>
          </div>
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={msgId}>
              {C.pgp.message}
            </label>
            <textarea id={msgId} className="x2f-textarea" rows={6} readOnly spellCheck={false} value={challenge.encryptedMessage} />
          </div>
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={codeId}>
              {C.pgp.code}
            </label>
            <input id={codeId} className="x2f-input" autoComplete="one-time-code" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <Button variant="primary" disabled={working} onClick={() => void add()}>
              {C.pgp.tapAndAdd}
            </Button>
          </div>
        </>
      )}
      <div>
        <Button variant="quiet" disabled={working} onClick={reset}>
          {C.pgp.cancel}
        </Button>
      </div>
      {fault !== null ? (
        <Notice tone="danger" data-part="add-pgp-fault">
          {fault}
        </Notice>
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </div>
  );
}

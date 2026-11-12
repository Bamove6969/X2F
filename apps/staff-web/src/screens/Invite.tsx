import { startRegistration } from '@simplewebauthn/browser';
import type { TermsSignature } from '@x2f/auth-client';
import type { LoginHours } from '@x2f/staff';
import { useEffect, useId, useState } from 'react';
import { useParams } from 'react-router';
import { inviteOptions } from '../challenges.js';
import { codeOf, inviteAccount, inviteFinish, inviteKeyFinish, inviteKeyStart, invitePgpFinish, invitePgpStart, inviteRead, type InviteView } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, Icon, Notice } from '../ui/kit.js';
import { PgpProof } from '../ui/PgpProof.js';
import { ROLE_LABELS } from '../ui/RoleChip.js';
import { TermsStep } from '../ui/TermsStep.js';
import '../ui/staff.css';

// Every sentence on this screen is draft copy (no board: DESIGNER-REVIEW). COPY-UNSIGNED

/** The plan's words for an invite link that no longer works (any invalid, used, cancelled or expired token). */
export const INVITE_GONE = 'This invite has already been used or has expired.';

/** The plan's result line (A8). */
export const keyCheckLine = (code: string) => `Your key check code: ${code}. Read it to the owner.`;

/** "Mon, Tue, Wed 09:00 to 17:00 (UTC)", or "at any time". */
export function hoursText(h: LoginHours): string {
  if (h === 'any') return 'at any time';
  return `${h.days.join(', ')}, ${h.start} to ${h.end} (${h.tz})`;
}

type Step = 'loading' | 'gone' | 'terms' | 'name' | 'keys' | 'done';
interface Added {
  /** Attested security keys (the ones a ruling and a moderator's login can use). */
  keys: number;
  passkeys: number;
  pgp: number;
}

/**
 * What the API's `finish` needs: owner G3 (owner-page3, review 8 Nov I-4), a moderator or senior
 * moderator holds all three methods (an attested security key, a passkey and a PGP key; two PGP keys
 * are not a pair for them); anyone else two factors (Task 7: PGP + a key, or two PGP keys).
 */
export function canFinish(role: InviteView['role'], a: Added): boolean {
  if (role === 'mod' || role === 'senior') return a.keys >= 1 && a.passkeys >= 1 && a.pgp >= 1;
  return (a.pgp >= 1 && a.keys + a.passkeys >= 1) || a.pgp >= 2;
}

/**
 * Invite acceptance at `/invite/:token` (Plan 4 Task 16, the API is Task 7's): the invite's role
 * and hours, the Terms with the signature pad (owner 9 Nov 2026, p11-14: everyone who gets a login
 * signs, staff too; TermsStep), a username and a private login name, then the login keys, then
 * finish. The accepted Terms version and the signature go with the names (`acceptedTerms`,
 * `termsSignature`); a 400 `terms-not-accepted` there (the Terms changed meanwhile) shows the Terms
 * again, empty, with the names kept. A return visit (the account is made, so the Terms are signed)
 * carries on at the keys. Moderators
 * and senior moderators hold all three methods (owner G3): an attested hardware security key, a
 * passkey on another device and a PGP key. Everyone else logs in with two factors (R1): a PGP key
 * and a key, or two PGP keys. The passkey row is shown for every role. The result shows the first security key's check code
 * to read to the owner (A8).
 */
export function Invite() {
  const token = useParams().token ?? '';
  const userId = useId();
  const loginId = useId();
  const [step, setStep] = useState<Step>('loading');
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [username, setUsername] = useState('');
  const [loginName, setLoginName] = useState('');
  /** The Terms version accepted and the signature given on the Terms step; null until then. */
  const [terms, setTerms] = useState<{ version: string; signature: TermsSignature } | null>(null);
  /** The API refused the last names call with `terms-not-accepted`: the Terms step says so. */
  const [termsChanged, setTermsChanged] = useState(false);
  const [added, setAdded] = useState<Added>({ keys: 0, passkeys: 0, pgp: 0 });
  const [checkCode, setCheckCode] = useState<string | null>(null);
  const [addingPgp, setAddingPgp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    inviteRead(token).then(
      (v) => {
        if (!live) return;
        setInvite(v);
        if (v.resume === null) {
          setStep('terms');
          return;
        }
        // A return visit: the names were picked before; carry on at the keys with what is in.
        setAdded({ keys: v.resume.keys, passkeys: v.resume.passkeys, pgp: v.resume.pgp });
        setCheckCode(v.resume.keyCheckCode);
        setStep('keys');
      },
      (e: unknown) => {
        if (!live) return;
        if (codeOf(e) === 'invite-invalid') setStep('gone');
        else {
          setStep('gone');
          setFault(faultText(e, 'X2F could not open this invite just now. Reload the page to try again.'));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [token]);

  const run = async (f: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setFault(null);
    try {
      await f();
    } catch (e) {
      if (codeOf(e) === 'invite-invalid') {
        setStep('gone');
        return;
      }
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else if (codeOf(e) === null && e instanceof Error && e.name !== 'TypeError') setFault('The key tap did not finish. Try again.');
      else setFault(faultText(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const createAccount = () =>
    run(async () => {
      if (terms === null) {
        // Not reachable from the page (the names come after the Terms); the Terms step is the answer.
        setStep('terms');
        return;
      }
      if (username.trim() === '' || loginName.trim() === '') {
        setFault('Fill in both names first.');
        return;
      }
      try {
        await inviteAccount(token, { displayName: username.trim(), loginName: loginName.trim(), acceptedTerms: terms.version, termsSignature: terms.signature });
      } catch (e) {
        if (codeOf(e) === 'terms-not-accepted') {
          // The Terms changed between reading and accepting (the trader's review M3): read and sign
          // the new version first. The names stay typed.
          setTerms(null);
          setTermsChanged(true);
          setStep('terms');
          return;
        }
        // The account was made on an earlier visit to this link: carry on with the keys.
        if (codeOf(e) !== 'wrong-state') throw e;
      }
      setStep('keys');
    }, 'That name did not work. Pick another one and try again.');

  const addKey = (kind: 'security-key' | 'passkey') =>
    run(async () => {
      const { options } = await inviteKeyStart(token, kind);
      // Re-verify X2: the key signs inviteRegistrationChallenge(the token in this link's hash), never the server's challenge.
      const response = await startRegistration({ optionsJSON: inviteOptions(options, token) });
      const r = await inviteKeyFinish(token, { kind, response });
      if (kind === 'passkey') setAdded((a) => ({ ...a, passkeys: a.passkeys + 1 }));
      else if (r.keyCheckCode === null) setFault('X2F could not check who made that key, so it cannot be used for staff work. Use a hardware security key such as a YubiKey.');
      else {
        setAdded((a) => ({ ...a, keys: a.keys + 1 }));
        setCheckCode((c) => c ?? r.keyCheckCode);
      }
    }, 'That key was not added. Try again.');

  const finish = () =>
    run(async () => {
      const r = await inviteFinish(token);
      setCheckCode(r.keyCheckCode);
      setStep('done');
    }, 'X2F could not finish just now. Try again.');

  const role = invite?.role ?? 'helper';
  const moderator = role === 'mod' || role === 'senior';

  return (
    <main className="x2f-staff-solo" data-screen="invite">
      <p className="x2f-staff-eyebrow">
        <Icon name="shield" size={16} />
        X2F Staff
      </p>
      {step === 'loading' ? <div aria-busy="true" /> : null}
      {step === 'gone' ? (
        <>
          <h1 className="x2f-staff-solo__title">This invite link does not work</h1>
          <Notice tone="caution" data-part="invite-gone">
            {INVITE_GONE}
          </Notice>
          <p className="x2f-staff-step__text">Ask the owner for a new invite link.</p>
        </>
      ) : null}
      {invite !== null && (step === 'terms' || step === 'name' || step === 'keys') ? (
        <>
          <h1 className="x2f-staff-solo__title">Join the X2F staff</h1>
          <p className="x2f-staff-step__text" data-part="invite-role">
            {`You're invited as ${ROLE_LABELS[invite.role]}. You can log in ${hoursText(invite.hours)}.`}
          </p>
        </>
      ) : null}
      {step === 'terms' ? (
        <TermsStep
          // The step numbers follow the Terms coming first (no board: DESIGNER-REVIEW). COPY-UNSIGNED
          heading="1. Terms of Service"
          changed={termsChanged}
          onAccept={(version, signature) => {
            setTerms({ version, signature });
            setFault(null);
            setStep('name');
          }}
        />
      ) : null}
      {step === 'name' ? (
        <section className="x2f-staff-step" aria-labelledby={`${userId}-h`}>
          <h2 id={`${userId}-h`} className="x2f-staff-step__title">
            2. Your names
          </h2>
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={userId}>
              Username
            </label>
            <input id={userId} className="x2f-input" autoComplete="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
            <p className="x2f-staff-hint">Shown to staff, never to traders</p>
          </div>
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={loginId}>
              Login name
            </label>
            <input id={loginId} className="x2f-input" autoComplete="username" spellCheck={false} value={loginName} onChange={(e) => setLoginName(e.target.value)} />
            <p className="x2f-staff-hint">Private. You type it to log in; nobody else sees it.</p>
          </div>
          <Button variant="primary" disabled={busy} onClick={() => void createAccount()}>
            Continue
          </Button>
        </section>
      ) : null}
      {step === 'keys' ? (
        <section className="x2f-staff-step" aria-labelledby={`${loginId}-k`}>
          <h2 id={`${loginId}-k`} className="x2f-staff-step__title">
            3. Your login keys
          </h2>
          <p className="x2f-staff-step__text">
            {moderator
              ? 'Moderators log in with three keys: a hardware security key, such as a YubiKey, a passkey on another device, and a PGP key.'
              : 'Staff log in with two keys: a security key or passkey and a PGP key, or two PGP keys.'}
          </p>
          <KeyRow name="Security key" done={added.keys} onAdd={() => void addKey('security-key')} busy={busy} />
          <KeyRow name="Passkey" done={added.passkeys} onAdd={() => void addKey('passkey')} busy={busy} />
          <div className="x2f-staff-key-row">
            <div>
              <p className="x2f-staff-key-row__name">PGP key</p>
              <p className="x2f-staff-key-row__note">{added.pgp === 0 ? 'Not added yet' : `${added.pgp} added`}</p>
            </div>
            {!addingPgp ? (
              <Button variant="secondary" disabled={busy} onClick={() => setAddingPgp(true)}>
                Add PGP key
              </Button>
            ) : null}
          </div>
          {addingPgp ? (
            <PgpProof
              start={(publicKey) => invitePgpStart(token, publicKey)}
              finish={async (challengeId, code) => {
                await invitePgpFinish(token, { challengeId, code });
              }}
              onProved={() => {
                setAdded((a) => ({ ...a, pgp: a.pgp + 1 }));
                setAddingPgp(false);
              }}
            />
          ) : null}
          {checkCode !== null ? (
            <p className="x2f-staff-hint" data-part="key-check">
              {keyCheckLine(checkCode)}
            </p>
          ) : null}
          <Button variant="primary" disabled={busy || !canFinish(role, added)} onClick={() => void finish()}>
            Finish
          </Button>
        </section>
      ) : null}
      {step === 'done' ? (
        <>
          <h1 className="x2f-staff-solo__title">You're on the staff</h1>
          {checkCode !== null ? (
            <p className="x2f-staff-code" data-part="key-check">
              {keyCheckLine(checkCode)}
            </p>
          ) : null}
          <Button variant="primary" href="/login">
            Log in
          </Button>
        </>
      ) : null}
      {fault !== null ? (
        <Notice tone="danger" data-part="invite-fault">
          {fault}
        </Notice>
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </main>
  );
}

function KeyRow({ name, done, onAdd, busy }: { name: string; done: number; onAdd: () => void; busy: boolean }) {
  return (
    <div className="x2f-staff-key-row">
      <div>
        <p className="x2f-staff-key-row__name">{name}</p>
        <p className="x2f-staff-key-row__note">{done === 0 ? 'Not added yet' : `${done} added`}</p>
      </div>
      <Button variant="secondary" disabled={busy} onClick={onAdd}>
        Tap key to register
      </Button>
    </div>
  );
}

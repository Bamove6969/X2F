import { startRegistration } from '@simplewebauthn/browser';
import { useEffect, useId, useState } from 'react';
import {
  codeOf,
  ownerKeys,
  setupAccount,
  setupCode,
  setupFinish,
  setupKeyFinish,
  setupKeyStart,
  setupPgpFinish,
  setupPgpStart,
  setupState,
} from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, Icon, Notice } from '../ui/kit.js';
import { PgpProof } from '../ui/PgpProof.js';
import '../ui/staff.css';

/** The locked page's words (A8). COPY-UNSIGNED */
export const LOCKED_TITLE = 'Owner setup is finished';
export const LOCKED_TEXT = 'This page is locked for good. The owner logs in on the staff login page.';
export const CODES_TEXT =
  'Your key check codes. When the moderation service is set up, its pin-owner step prints the same codes: check that every one matches before you type yes.';

type Phase = 'loading' | 'open' | 'locked';
type KeySlot = 'main' | 'spare';

/**
 * Owner first-run setup at `/setup` (board OwnerSetup; the API is Plan 4 Task 6's). Steps 1-4 as
 * the board: the one-time setup code from the server's log, the username, the two hardware
 * security keys (main and spare), the PGP key. "Create owner account" stays disabled until both
 * keys are registered and the PGP key is in (A9: setup cannot finish without it, so the board's
 * "(optional)" is left off; OWNER-Q). Then the page locks; the locked page shows the owner's key
 * check codes for `pin-owner` (A8): straight after finishing from the answer, and on a later visit
 * from the owner's keys when the owner is logged in.
 *
 * The board has one name field, but the API also needs the private login name (OWNER-Q): step 2
 * asks for both. The names are sent (the pending owner account is made) when the first key is
 * tapped or the PGP key is added, and cannot change after that: sending new names would make a
 * new pending owner and drop the keys already registered.
 */
export function OwnerSetup() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setupState().then(
      (s) => {
        if (live) setPhase(s);
      },
      (e: unknown) => {
        if (!live) return;
        setPhase('open');
        setFault(faultText(e, 'X2F could not check the setup page just now. Reload to try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'locked' || codes !== null) return;
    let live = true;
    // Only the owner's own session can read these; anyone else sees the locked page without them.
    ownerKeys().then(
      (r) => {
        if (live) setCodes(r.keys.map((k) => k.keyCheckCode));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [phase, codes]);

  if (phase === 'loading') return <main className="x2f-staff-solo" data-screen="owner-setup" aria-busy="true" />;
  if (phase === 'locked') return <Locked codes={codes} />;
  return (
    <SetupForm
      fault={fault}
      onFinished={(c) => {
        setCodes(c);
        setPhase('locked');
      }}
    />
  );
}

function Locked({ codes }: { codes: string[] | null }) {
  return (
    <main className="x2f-staff-solo" data-screen="owner-setup" data-state="locked">
      <p className="x2f-staff-eyebrow">
        <Icon name="shield" size={16} />
        First-time setup
      </p>
      <h1 className="x2f-staff-solo__title">{LOCKED_TITLE}</h1>
      <p className="x2f-staff-step__text">{LOCKED_TEXT}</p>
      {codes !== null && codes.length > 0 ? (
        <section className="x2f-staff-step" aria-label="Key check codes">
          <p className="x2f-staff-step__text">{CODES_TEXT}</p>
          <ul className="x2f-codes" data-part="key-check-codes">
            {codes.map((c) => (
              <li key={c} className="x2f-codes__item x2f-staff-code" data-mask="">
                {c}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Button variant="primary" href="/login">
        Go to staff login
      </Button>
    </main>
  );
}

function SetupForm({ fault: initialFault, onFinished }: { fault: string | null; onFinished: (codes: string[]) => void }) {
  const codeId = useId();
  const nameId = useId();
  const loginId = useId();
  const [code, setCode] = useState('');
  const [codeOk, setCodeOk] = useState(false);
  const [username, setUsername] = useState('');
  const [loginName, setLoginName] = useState('');
  const [accountMade, setAccountMade] = useState(false);
  const [keys, setKeys] = useState<Record<KeySlot, boolean>>({ main: false, spare: false });
  const [pgp, setPgp] = useState(false);
  const [addingPgp, setAddingPgp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(initialFault);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);

  const run = async (f: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setFault(null);
    try {
      await f();
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else if (codeOf(e) === 'setup-locked') window.location.reload();
      else if (codeOf(e) === 'not-authenticated') {
        // The setup cookie lasts 30 minutes: past that, the code is asked again.
        setCodeOk(false);
        setFault('Setup timed out. Type the setup code again to carry on.');
      } else if (codeOf(e) === null && e instanceof Error && e.name !== 'TypeError') setFault('The key tap did not finish. Try again.');
      else setFault(faultText(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const checkCode = () =>
    run(async () => {
      try {
        await setupCode(code.trim());
        setCodeOk(true);
      } catch (e) {
        if (codeOf(e) === 'code-invalid') {
          setFault('That is not the setup code. Copy it again from the server log.');
          return;
        }
        throw e;
      }
    }, 'X2F could not check that code. Try again.');

  const ensureAccount = async () => {
    if (accountMade) return;
    if (username.trim() === '' || loginName.trim() === '') throw new NamesMissing();
    await setupAccount({ username: username.trim(), loginName: loginName.trim() });
    setAccountMade(true);
  };

  const withNames = (f: () => Promise<void>, fallback: string) =>
    run(async () => {
      try {
        await f();
      } catch (e) {
        if (e instanceof NamesMissing) {
          setFault('Fill in step 2 first.');
          return;
        }
        throw e;
      }
    }, fallback);

  const registerKey = (slot: KeySlot) =>
    withNames(async () => {
      await ensureAccount();
      const { challengeId, options } = await setupKeyStart();
      const response = await startRegistration({ optionsJSON: options });
      await setupKeyFinish({ challengeId, response, label: slot === 'main' ? 'Main key' : 'Spare key' });
      setKeys((k) => ({ ...k, [slot]: true }));
    }, 'That key was not registered. Try again.');

  const openPgp = () =>
    withNames(async () => {
      await ensureAccount();
      setAddingPgp(true);
    }, 'X2F could not save your names. Pick another username and try again.');

  const finish = () =>
    run(async () => {
      const r = await setupFinish();
      onFinished(r.keyCheckCodes);
    }, 'X2F could not finish setup just now. Try again.');

  const bothKeys = keys.main && keys.spare;
  const ready = codeOk && bothKeys && pgp;

  return (
    <main className="x2f-staff-solo" data-screen="owner-setup" data-state="open">
      <p className="x2f-staff-eyebrow">
        <Icon name="shield" size={16} />
        First-time setup
      </p>
      <h1 className="x2f-staff-solo__title">Create the owner account</h1>
      <p className="x2f-staff-step__text">
        The owner adds and removes staff, sets the rules for large trades and sees every action taken. This page works once. After you finish, it locks for good.
      </p>

      <section className="x2f-staff-step" data-done={codeOk ? 'true' : 'false'} aria-labelledby={`${codeId}-h`}>
        <h2 id={`${codeId}-h`} className="x2f-staff-step__title">
          1. Setup code
        </h2>
        <p className="x2f-staff-step__text">
          The server printed a one-time code in its log when it first started. Only someone with access to the server can see it, which stops anyone else from claiming this page.
        </p>
        <label className="x2f-offscreen" htmlFor={codeId}>
          Setup code
        </label>
        <input id={codeId} className="x2f-input" data-mask="" autoComplete="off" spellCheck={false} readOnly={codeOk} value={code} onChange={(e) => setCode(e.target.value)} />
        {codeOk ? (
          <p className="x2f-staff-ok" data-part="code-ok">
            <Icon name="check" size={16} />
            Code accepted
          </p>
        ) : (
          <Button variant="secondary" disabled={busy || code.trim() === ''} onClick={() => void checkCode()}>
            Check code
          </Button>
        )}
      </section>

      <section className="x2f-staff-step" aria-labelledby={`${nameId}-h`}>
        <h2 id={`${nameId}-h`} className="x2f-staff-step__title">
          2. Your username
        </h2>
        <label className="x2f-offscreen" htmlFor={nameId}>
          Username
        </label>
        <p className="x2f-staff-hint">Shown to staff, never to traders</p>
        <input id={nameId} className="x2f-input" data-mask="" autoComplete="off" spellCheck={false} readOnly={accountMade} disabled={!codeOk} value={username} onChange={(e) => setUsername(e.target.value)} />
        {/* Not on the board: the API needs the private login name too (OWNER-Q). COPY-UNSIGNED */}
        <label className="x2f-label" htmlFor={loginId}>
          Login name
        </label>
        <p className="x2f-staff-hint">Private. You type it to log in; nobody else sees it.</p>
        <input id={loginId} className="x2f-input" data-mask="" autoComplete="username" spellCheck={false} readOnly={accountMade} disabled={!codeOk} value={loginName} onChange={(e) => setLoginName(e.target.value)} />
      </section>

      <section className="x2f-staff-step" aria-labelledby={`${nameId}-k`}>
        <h2 id={`${nameId}-k`} className="x2f-staff-step__title">
          3. Two security keys
        </h2>
        <p className="x2f-staff-step__text">
          The owner account logs in only with a hardware security key, such as a YubiKey. Register two: one you use, and a spare you keep somewhere safe. There is no password and no reset by message.
        </p>
        <KeySlotRow name="Main key" note="The one you carry" done={keys.main} disabled={busy || !codeOk} onTap={() => void registerKey('main')} />
        <KeySlotRow name="Spare key" note="Keep it somewhere safe, apart from the main key" done={keys.spare} disabled={busy || !codeOk || !keys.main} onTap={() => void registerKey('spare')} />
      </section>

      <section className="x2f-staff-step" aria-labelledby={`${loginId}-p`}>
        <h2 id={`${loginId}-p`} className="x2f-staff-step__title">
          4. PGP key
        </h2>
        {/* The board's sentence; the owner's login needs the PGP key with a security key (A9). OWNER-Q */}
        <p className="x2f-staff-step__text">Add your PGP public key. The owner logs in with it together with a security key.</p>
        {pgp ? (
          <p className="x2f-staff-ok" data-part="pgp-ok">
            <Icon name="check" size={16} />
            PGP key added
          </p>
        ) : addingPgp ? (
          <PgpProof
            start={(publicKey) => setupPgpStart(publicKey)}
            finish={async (challengeId, c) => {
              await setupPgpFinish({ challengeId, code: c });
            }}
            onProved={() => {
              setPgp(true);
              setAddingPgp(false);
            }}
          />
        ) : (
          <Button variant="secondary" disabled={busy || !codeOk} onClick={() => void openPgp()}>
            Add PGP key
          </Button>
        )}
      </section>

      {fault !== null ? (
        <Notice tone="danger" data-part="setup-fault">
          {fault}
        </Notice>
      ) : null}
      <Button variant="primary" disabled={busy || !ready} onClick={() => void finish()}>
        Create owner account
      </Button>
      {!ready ? (
        <p className="x2f-staff-hint" data-part="setup-hint">
          {/* The board's line; the PGP half is COPY-UNSIGNED. */}
          {!bothKeys ? 'Register both keys to continue.' : 'Add your PGP key to continue.'}
        </p>
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </main>
  );
}

class NamesMissing extends Error {}

function KeySlotRow({ name, note, done, disabled, onTap }: { name: string; note: string; done: boolean; disabled: boolean; onTap: () => void }) {
  return (
    <div className="x2f-staff-key-row" data-part="key-slot" data-done={done ? 'true' : 'false'}>
      <div>
        <p className="x2f-staff-key-row__name">{name}</p>
        <p className="x2f-staff-key-row__note">{note}</p>
      </div>
      {done ? (
        <p className="x2f-staff-ok">
          <Icon name="check" size={16} />
          Registered
        </p>
      ) : (
        <Button variant="secondary" disabled={disabled} onClick={onTap}>
          Tap key to register
        </Button>
      )}
    </div>
  );
}

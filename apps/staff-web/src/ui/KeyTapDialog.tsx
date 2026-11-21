import { startAuthentication } from '@simplewebauthn/browser';
import { canonicalJson, hasIssuedAt, tapChallenge, type KeyTapIntent } from '@x2f/staff';
import { useId, useState } from 'react';
import { codeOf, tapFinish, tapStart } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, Notice, Sheet } from './kit.js';

/**
 * The one key-tap dialog (Plan 4 Task 16), used by every tapped action (Tasks 7, 8, 12, 17, 18):
 * "Tap security key" calls `POST /staff/v1/taps/start` with the intent, runs the browser's
 * `startAuthentication` on the options, then `POST /staff/v1/taps/:id/finish`, and hands the
 * `tapId` to `onDone`; the action's own request then carries it. A cancelled or failed tap keeps
 * the dialog open to try again; a refusal (no security key on this account) is the kit's
 * CantDoThat.
 *
 * No board of its own: built from the kit's Sheet (centred on the wide layout). DESIGNER-REVIEW
 *
 * Re-verify X1 (lead call, 12 Nov): a security key shows nothing of what it signs, so this dialog
 * shows the whole intent, and before the key is asked it rebuilds the challenge itself:
 * `tapChallenge(intent + issuedAt, nonce)` from the nonce and issuedAt `taps/start` answers. A
 * challenge for anything else, an issuedAt more than TAP_CLOCK_SKEW_MS from this device's clock,
 * or an issuedAt on a kind that carries none is refused and nothing is signed. This only holds
 * while this code is the code the browser runs: docs/dev-setup.md (deploy) says the staff site is
 * served from a build the API host cannot change.
 */
/** How far the server's issuedAt may be from this device's clock: 2 minutes (lead call). */
export const TAP_CLOCK_SKEW_MS = 2 * 60_000;

/** What the key would sign, or why not: the challenge the server sent must be exactly this intent's. */
export function checkTapChallenge(intent: KeyTapIntent, got: { options: { challenge: string }; nonce: string; issuedAt: string | null }, now = Date.now()): boolean {
  if (typeof got?.nonce !== 'string' || !/^(?:[0-9a-f]{2}){16,64}$/.test(got.nonce)) return false;
  let signed: KeyTapIntent = intent;
  if (hasIssuedAt(intent.kind)) {
    const at = typeof got.issuedAt === 'string' ? Date.parse(got.issuedAt) : Number.NaN;
    if (!Number.isFinite(at) || Math.abs(at - now) > TAP_CLOCK_SKEW_MS) return false;
    signed = { ...intent, issuedAt: got.issuedAt } as KeyTapIntent;
  } else if (got.issuedAt !== null) {
    return false;
  }
  const nonce = new Uint8Array(got.nonce.match(/../g)!.map((h) => Number.parseInt(h, 16)));
  let want: Uint8Array;
  try {
    want = tapChallenge(signed, nonce);
  } catch {
    return false;
  }
  let b = '';
  for (const x of want) b += String.fromCharCode(x);
  const b64url = btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return got.options?.challenge === b64url;
}

/** The intent as name/value lines, every field (nested values as JSON). */
function intentLines(intent: KeyTapIntent): Array<[string, string]> {
  return Object.entries(intent).map(([k, v]) => [k, typeof v === 'string' ? v : canonicalJson(v)]);
}
export function KeyTapDialog({
  intent,
  title,
  body,
  onDone,
  onCancel,
  tapLabel = 'Tap security key',
  labels = {},
}: {
  intent: KeyTapIntent;
  title: string;
  body: string;
  onDone: (tapId: string) => void;
  onCancel: () => void;
  /** The button's words where a board names them ("Tap key and pause"). */
  tapLabel?: string;
  /**
   * X3 (re-verify round 3): what each signed field is, in words the person knows, shown next to its
   * value ("nightowl_44" next to an account id, "the reason above" next to its hash). COPY-UNSIGNED.
   */
  labels?: Readonly<Partial<Record<string, string>>>;
}) {
  const bodyId = useId();
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);

  const tap = async () => {
    setBusy(true);
    setFault(null);
    try {
      const started = await tapStart(intent);
      if (!checkTapChallenge(intent, started)) {
        // COPY-UNSIGNED
        setFault('The server asked your key to sign something other than what is shown here. Nothing was signed. Tell the owner.');
        return;
      }
      const { tapId, options } = started;
      const response = await startAuthentication({ optionsJSON: options });
      const done = await tapFinish(tapId, response);
      onDone(done.tapId);
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      // COPY-UNSIGNED
      else if (codeOf(e) === null && e instanceof Error && e.name !== 'TypeError') setFault('The key tap did not finish. Try again.');
      else setFault(faultText(e, 'That key tap did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (refusal !== null) return <CantDoThat body={refusal.text} from={refusal.code} onClose={onCancel} />;

  return (
    <Sheet open title={title} describedBy={bodyId} wide="dialog" onClose={onCancel}>
      <div className="x2f-stack" data-part="key-tap">
        <p id={bodyId}>{body}</p>
        {/* COPY-UNSIGNED, DESIGNER-REVIEW: the whole intent, plain, until design words each kind. */}
        <dl className="x2f-keytap__intent" data-part="key-tap-intent" aria-label="What your key signs">
          {intentLines(intent).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                {v}
                {labels[k] !== undefined ? <span className="x2f-keytap__label">{` (${labels[k]})`}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
        {fault !== null ? (
          <Notice tone="danger" data-part="key-tap-fault">
            {fault}
          </Notice>
        ) : null}
        <Button variant="primary" disabled={busy} onClick={() => void tap()}>
          {tapLabel}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

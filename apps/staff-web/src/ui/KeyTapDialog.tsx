import { startAuthentication } from '@simplewebauthn/browser';
import type { KeyTapIntent } from '@x2f/staff';
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
 */
export function KeyTapDialog({
  intent,
  title,
  body,
  onDone,
  onCancel,
  tapLabel = 'Tap security key',
}: {
  intent: KeyTapIntent;
  title: string;
  body: string;
  onDone: (tapId: string) => void;
  onCancel: () => void;
  /** The button's words where a board names them ("Tap key and pause"). */
  tapLabel?: string;
}) {
  const bodyId = useId();
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);

  const tap = async () => {
    setBusy(true);
    setFault(null);
    try {
      const { tapId, options } = await tapStart(intent);
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

import { maintenancePlannedIntent } from '@x2f/staff';
import { useId, useState } from 'react';
import { announcePlannedMaintenance, removePlannedMaintenance, type StaffSite } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, Notice } from '../ui/kit.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { utcMinuteText } from './staffFormat.js';

/**
 * Review p4t22 N2: the owner announces a planned maintenance ahead (owner G19: "we will plan it and
 * try and give 24-hour notice"), shown to every visitor until it ends (`PUT
 * /staff/v1/site/maintenance/planned`). Announcing takes the owner's key tap (`maintenance-planned`),
 * bound to the start and end as sent and to the SHA-256 of the message as sent, all built here from
 * the fields; removing the announcement takes none (it only takes text away). Times are typed and
 * shown in UTC, as the rest of the site controls. No board: COPY-UNSIGNED, DESIGNER-REVIEW.
 */

/** The maintenance message's limit (site.ts MAINTENANCE_MESSAGE_MAX). */
const MESSAGE_MAX = 500;

/** A `datetime-local` value read as UTC (`YYYY-MM-DDTHH:MM`), as the exact ISO time the API and the tap bind; null when not one. */
export function utcInputIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const iso = `${v}:00.000Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) || d.toISOString() !== iso ? null : iso;
}

export function PlannedMaintenance({ plan, onChange }: { plan: StaffSite['planned'] | undefined; onChange: (s: StaffSite | null) => void }) {
  const startId = useId();
  const endId = useId();
  const msgId = useId();
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [message, setMessage] = useState('');
  const [tapOpen, setTapOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  const startsAt = utcInputIso(starts);
  const endsAt = utcInputIso(ends);
  const sent = message.trim() === '' ? null : message.trim();
  const ready = startsAt !== null && endsAt !== null && Date.parse(endsAt) > Date.parse(startsAt) && [...message].length <= MESSAGE_MAX;

  const announce = async (tapId: string) => {
    if (startsAt === null || endsAt === null) return;
    setBusy(true);
    setFault(null);
    try {
      onChange(await announcePlannedMaintenance({ startsAt, endsAt, message: sent, tapId }));
    } catch (e) {
      setFault(faultText(e, 'The planned maintenance was not announced. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setFault(null);
    try {
      await removePlannedMaintenance();
      onChange(null);
    } catch (e) {
      setFault(faultText(e, 'The announcement was not removed. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Planned maintenance" className="x2f-staff-card x2f-stack" data-part="planned-maintenance">
      <h2 className="x2f-h2">Planned maintenance</h2>
      {plan ? (
        <>
          <p className="x2f-staff-hint" data-part="planned-state">
            {`Announced: ${utcMinuteText(plan.startsAt)} to ${utcMinuteText(plan.endsAt)}.`}
          </p>
          {plan.message !== null ? <p>{plan.message}</p> : null}
          <Button variant="secondary" disabled={busy} onClick={() => void remove()}>
            Remove the announcement
          </Button>
        </>
      ) : (
        <p className="x2f-staff-hint" data-part="planned-state">
          No planned maintenance announced.
        </p>
      )}
      <p className="x2f-staff-page__lead">Every visitor sees the announcement until it ends. A new one replaces the old one.</p>
      <div className="x2f-field">
        <label htmlFor={startId} className="x2f-label">
          Starts (UTC)
        </label>
        <input id={startId} type="datetime-local" className="x2f-input" value={starts} onChange={(e) => setStarts(e.target.value)} />
      </div>
      <div className="x2f-field">
        <label htmlFor={endId} className="x2f-label">
          Ends (UTC)
        </label>
        <input id={endId} type="datetime-local" className="x2f-input" value={ends} onChange={(e) => setEnds(e.target.value)} />
      </div>
      <div className="x2f-field">
        <label htmlFor={msgId} className="x2f-label">
          Message to users
        </label>
        <input id={msgId} type="text" className="x2f-input" value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <Button variant="secondary" disabled={busy || !ready} onClick={() => setTapOpen(true)}>
        Announce
      </Button>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {tapOpen && startsAt !== null && endsAt !== null ? (
        <KeyTapDialog
          intent={maintenancePlannedIntent({ startsAt, endsAt, message: sent })}
          title="Announce planned maintenance"
          // not-a-refusal: a description of what announcing does, in the tap dialog.
          body="Tap your security key to announce this planned maintenance. Every visitor sees it until it ends."
          tapLabel="Tap key and announce"
          labels={{ messageSha256: 'the message above', startsAt: 'the start above', endsAt: 'the end above' }}
          onDone={(tapId) => {
            setTapOpen(false);
            void announce(tapId);
          }}
          onCancel={() => setTapOpen(false)}
        />
      ) : null}
    </section>
  );
}

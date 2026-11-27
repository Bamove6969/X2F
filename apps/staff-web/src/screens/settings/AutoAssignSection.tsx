import { useEffect, useState } from 'react';
import { putAutoAssign, settings as fetchSettings, type AutoAssignSettings } from '../../api.js';
import { faultText, type StaffRefusal } from '../../refusals.js';
import { CantDoThat } from '../../ui/kit.js';
import { failureOf, SectionFoot, SettingField, SettingsCard } from './sectionKit.js';

/**
 * Owner decision (Jess, 26 Nov 2026), "Pool first, auto-assign if untaken": cases wait in the pool
 * where any moderator may take one; a case nobody takes within these minutes goes to the least-busy
 * moderator on shift. `PUT /staff/v1/settings` with what changed (`autoAssignMin` 1 to 1440,
 * `autoAssignOn`); no tap, since neither binds a ruling (apps/api/src/staff/settings.ts). The API
 * logs each change with its old and new value. No board draws it (DESIGNER-REVIEW). Words:
 * COPY-UNSIGNED (all of C).
 */
const C = {
  title: 'Case assignment',
  lead: 'New disputes wait in the queue for a moderator to take them. If nobody takes one in time, X2F gives it to the moderator on shift with the fewest open cases. Senior moderators and you can still reassign any case.',
  on: 'Assign untaken cases automatically',
  minutes: {
    label: 'Assign after',
    unit: 'minutes',
    help: 'How long a case waits untaken first, from when it opens or comes back to the queue (1 to 1,440 minutes). With nobody on shift it waits until someone clocks in.',
    problem: 'Assign after (1 to 1,440 minutes)',
  },
  save: 'Save case assignment',
  loadFault: 'X2F could not load the case assignment settings just now. Reload to try again.',
  saveFault: 'The case assignment settings were not saved. Try again.',
} as const;

/** The API's bounds (apps/api/src/staff/settings.ts BOUNDS.autoAssignMin). */
export const AUTO_ASSIGN_MIN_BOUNDS = [1, 1440] as const;

/** The minutes as typed ("1,440" reads 1440); null when they are not an allowed whole number. */
export function autoAssignMinOf(typed: string): number | null {
  const t = typed.replace(/,/g, '').trim();
  if (!/^\d+$/.test(t)) return null;
  const v = Number(t);
  return v >= AUTO_ASSIGN_MIN_BOUNDS[0] && v <= AUTO_ASSIGN_MIN_BOUNDS[1] ? v : null;
}

export function AutoAssignSection() {
  const [stored, setStored] = useState<AutoAssignSettings | null>(null);
  const [minutes, setMinutes] = useState('');
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);

  const show = (s: AutoAssignSettings) => {
    setStored({ autoAssignMin: s.autoAssignMin, autoAssignOn: s.autoAssignOn });
    setMinutes(String(s.autoAssignMin));
    setOn(s.autoAssignOn);
  };
  useEffect(() => {
    fetchSettings().then(
      (s) => show(s as unknown as AutoAssignSettings),
      (e: unknown) => setFault(faultText(e, C.loadFault)),
    );
  }, []);

  const min = autoAssignMinOf(minutes);
  const problems = min === null ? [C.minutes.problem] : [];
  const change: Partial<AutoAssignSettings> = {};
  if (stored !== null && min !== null && min !== stored.autoAssignMin) change.autoAssignMin = min;
  if (stored !== null && on !== stored.autoAssignOn) change.autoAssignOn = on;
  const canSave = stored !== null && problems.length === 0 && Object.keys(change).length > 0;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setFault(null);
    setSaved(false);
    try {
      show(await putAutoAssign(change));
      setSaved(true);
    } catch (e) {
      const f = failureOf(e, C.saveFault);
      if ('refusal' in f) setRefusal(f.refusal);
      else setFault(f.fault);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard label={C.title} lead={C.lead} part="auto-assign">
      <label className="x2f-check">
        <input
          type="checkbox"
          data-part="auto-assign-on"
          checked={on}
          onChange={(e) => {
            setSaved(false);
            setOn(e.target.checked);
          }}
        />
        <span>{C.on}</span>
      </label>
      <SettingField
        label={C.minutes.label}
        unit={C.minutes.unit}
        help={C.minutes.help}
        value={minutes}
        invalid={min === null}
        onChange={(v) => {
          setSaved(false);
          setMinutes(v);
        }}
      />
      <SectionFoot part="auto-assign" problems={stored === null ? [] : problems} fault={fault} saved={saved} saveLabel={C.save} canSave={canSave} busy={busy} onSave={() => void save()} />
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </SettingsCard>
  );
}

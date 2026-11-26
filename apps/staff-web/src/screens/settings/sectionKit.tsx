import { useId, type ReactNode } from 'react';
import { faultText, refusalOf, type StaffRefusal } from '../../refusals.js';
import { utcMinuteText } from '../staffFormat.js';
import { Button, Notice } from '../../ui/kit.js';
import '../../ui/staff.css';

/**
 * What the owner Settings sections added for spec 6.6 "Settings" share (links, starter limits, fee
 * wallet): one card with its own heading, fields in the Rulings section's layout, an input-check
 * notice, a saved notice and its own Save button. Save is the outlined button: the page's one
 * primary action stays "Save settings" (Rulings and Staff pay, board StaffSettings parity), and is
 * disabled until the section's fields read as an allowed value that differs from what is saved.
 * No board draws these sections (DESIGNER-REVIEW). Words: COPY-UNSIGNED
 */

/** A section's outcome after a failed call: a refusal for CantDoThat, or a fault line. */
export function failureOf(e: unknown, fallback: string): { refusal: { code: StaffRefusal; text: string } } | { fault: string } {
  const r = refusalOf(e);
  return r !== null ? { refusal: r } : { fault: faultText(e, fallback) };
}

export function SettingsCard({ label, lead, part, children }: { label: string; lead?: ReactNode; part: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="x2f-staff-card x2f-stack" data-part={part}>
      <div className="x2f-stack">
        <h2 className="x2f-h2">{label}</h2>
        {lead !== undefined ? <span className="x2f-staff-hint">{lead}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** One labelled text field in the Rulings layout: the input, its unit and its help line. */
export function SettingField({
  label,
  value,
  onChange,
  unit,
  help,
  placeholder,
  wide = false,
  invalid = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  help?: string;
  placeholder?: string;
  /** A link or an address: the full-width input rather than the short number one. */
  wide?: boolean;
  invalid?: boolean;
}) {
  const id = useId();
  return (
    <div className="x2f-staff-setting">
      <label htmlFor={id} className="x2f-staff-setting__label">
        {label}
      </label>
      <span className="x2f-staff-setting__value">
        <input
          id={id}
          type="text"
          inputMode={wide ? 'url' : 'numeric'}
          spellCheck={false}
          autoComplete="off"
          className={wide ? 'x2f-input' : 'x2f-input x2f-staff-number'}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit !== undefined ? <span className="x2f-staff-hint">{unit}</span> : null}
      </span>
      {help !== undefined ? <span className="x2f-staff-hint">{help}</span> : null}
    </div>
  );
}

/** The foot of a section: what to fix, the fault, "Saved." and the section's Save button. */
export function SectionFoot({
  part,
  problems,
  fault,
  saved,
  updatedAt,
  saveLabel,
  canSave,
  busy,
  onSave,
}: {
  part: string;
  problems: readonly string[];
  fault: string | null;
  saved: boolean;
  /** When the section was last saved, when the API says (it does not say by whom). */
  updatedAt?: string | null;
  saveLabel: string;
  canSave: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <>
      {problems.length > 0 ? (
        // not-a-refusal: an input check naming the fields to fix. COPY-UNSIGNED
        <Notice tone="danger" data-part={`${part}-invalid`}>{`Check these: ${problems.join('; ')}.`}</Notice>
      ) : null}
      {fault !== null ? (
        <Notice tone="danger" data-part={`${part}-fault`}>
          {fault}
        </Notice>
      ) : null}
      {saved ? (
        // COPY-UNSIGNED
        <Notice tone="plain" data-part={`${part}-saved`}>
          Saved.
        </Notice>
      ) : null}
      {updatedAt !== undefined && updatedAt !== null ? (
        // COPY-UNSIGNED: the API records when, not who; only the owner can change these.
        <span className="x2f-staff-hint" data-part={`${part}-updated`}>{`Last changed ${utcMinuteText(updatedAt)}`}</span>
      ) : null}
      <div>
        <Button variant="secondary" data-part={`${part}-save`} disabled={busy || !canSave} onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
    </>
  );
}

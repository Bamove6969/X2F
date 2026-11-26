import type { KeyTapIntent } from '@x2f/staff';
import { useEffect, useId, useState } from 'react';
import { paySettings as fetchPay, putPaySettings, putSettings, settings as fetchSettings, type PaySettings, type RulingSettings } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, Notice } from '../ui/kit.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { PageTitle } from '../ui/StaffShell.js';
import { FeeSweepSection } from './settings/FeeSweepSection.js';
import { LinksSection } from './settings/LinksSection.js';
import { StaffPaySection } from './settings/StaffPaySection.js';
import { StarterLimitsSection } from './settings/StarterLimitsSection.js';
import '../ui/staff.css';

/**
 * The owner's Settings page (Plan 4 Task 17, board StaffSettings; perm settings.write).
 *
 * Rulings: the three fields with the board's help text (`PUT /staff/v1/settings`). The large-trade
 * limit and the appeal window bind the moderation gate, so a change to either takes a `settings`
 * tap of the three values after the change (Task 8); the first response deadline alone takes none.
 *
 * Staff pay: the board's three pay fields (per case, and the helper's monthly rate, Plan 4's A3)
 * were replaced by Task 33 as built (owner, 2026-10-29c and the lead's q5/q6 calls): pay is per
 * completed dispute only, at a correct clock-out, plus a senior moderator's share of large-trade
 * fees. So this section shows Task 33's four settings (`PUT /staff/v1/pay/settings`, a
 * `pay-settings` tap of all four), each "Not set" while null. Its words are draft copy, not the
 * board's (OWNER-Q, DESIGNER-REVIEW: the PaySetup board is not drawn). COPY-UNSIGNED
 *
 * "Save settings" (the page's one primary action) saves what changed: the rulings first, then pay,
 * each with its own tap when it needs one.
 *
 * Spec 6.6 "Settings" (the rest of the owner's settings, no board draws them; DESIGNER-REVIEW):
 * below, each with its own outlined Save, are the starter limits (tap `starter-limits`), the
 * moderator contact and community links (no tap), the fee wallet's sweep (tap `fee-sweep`) and,
 * read only, the pay each staff member is owed (`settings/`).
 */

type RulingField = keyof RulingSettings;
type PayField = keyof PaySettings;

/** The API's bounds (apps/api/src/staff/settings.ts BOUNDS; pay.ts PAY_BOUNDS, shown here in dollars and percent). */
const RULING_BOUNDS: Readonly<Record<RulingField, readonly [number, number]>> = {
  largeTradeLimitUsd: [1, 1_000_000],
  firstResponseH: [1, 72],
  appealWindowH: [12, 168],
};

const RULING_FIELDS: ReadonlyArray<{ field: RulingField; label: string; unit: string; help: string }> = [
  // not-a-refusal: board StaffSettings' help text, explaining the two-person rule; it stops nobody.
  { field: 'largeTradeLimitUsd', label: 'Large-trade limit', unit: 'USD equivalent', help: 'A moderator can rule alone on trades below this. At or above it, a senior moderator or you must approve too.' },
  { field: 'firstResponseH', label: 'First response deadline', unit: 'hours', help: 'How soon a moderator must reply after a dispute opens. Traders see this deadline and their place in the queue.' },
  { field: 'appealWindowH', label: 'Appeal window', unit: 'hours', help: 'How long either trader has to appeal a ruling. Appeals go to a senior moderator or you, never the moderator who ruled.' },
];

/** How each pay setting is typed: dollars (to cents), a percent (to basis points) or whole dollars. COPY-UNSIGNED */
const PAY_FIELDS: ReadonlyArray<{ field: PayField; label: string; unit: string; help: string; kind: 'cents' | 'bp' | 'usd'; max: number; min: number }> = [
  { field: 'modDisputeUsdCents', label: 'Moderator, per dispute', unit: 'USD in XMR', help: 'For each dispute they complete. A ruling overturned on appeal is taken back.', kind: 'cents', min: 0, max: 10_000_000 },
  { field: 'seniorDisputeUsdCents', label: 'Senior moderator, per dispute', unit: 'USD in XMR', help: 'For each dispute they complete. A ruling overturned on appeal is taken back.', kind: 'cents', min: 0, max: 10_000_000 },
  { field: 'seniorLargeTradeBp', label: 'Senior moderator, share of large-trade fees', unit: '% of the fee', help: "Of X2F's fee on a large trade whose dispute they decided or co-approved.", kind: 'bp', min: 0, max: 10_000 },
  { field: 'largeTradeThresholdUsd', label: 'Large trade from', unit: 'USD', help: 'A trade at or above this value, when its dispute opened, counts as large for the share above.', kind: 'usd', min: 1, max: 10_000_000 },
];

/** A whole number as typed ("2,500" reads 2500); null when it is not one. */
function wholeOf(s: string): number | null {
  const t = s.replace(/,/g, '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** A pay field as typed, in the API's unit: '' is not set (null); undefined when it cannot be read. */
function payOf(s: string, kind: 'cents' | 'bp' | 'usd'): number | null | undefined {
  const t = s.replace(/,/g, '').trim();
  if (t === '') return null;
  if (kind === 'usd') return /^\d+$/.test(t) ? Number(t) : undefined;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** The API's value as the field shows it ("25.00" dollars, "2.5" percent, "5000"); '' when not set. */
function payText(v: number | null, kind: 'cents' | 'bp' | 'usd'): string {
  if (v === null) return '';
  if (kind === 'usd') return String(v);
  if (kind === 'cents') return (v / 100).toFixed(2);
  return String(v / 100);
}

type Step = { intent: KeyTapIntent; title: string; body: string; run: (tapId: string) => Promise<void> };

export function StaffSettings() {
  const [stored, setStored] = useState<RulingSettings | null>(null);
  const [pay, setPay] = useState<PaySettings | null>(null);
  const [ruling, setRuling] = useState<Record<RulingField, string>>({ largeTradeLimitUsd: '', firstResponseH: '', appealWindowH: '' });
  const [payDraft, setPayDraft] = useState<Record<PayField, string>>({ modDisputeUsdCents: '', seniorDisputeUsdCents: '', seniorLargeTradeBp: '', largeTradeThresholdUsd: '' });
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const ids = useId();

  const showRuling = (s: RulingSettings) => {
    setStored(s);
    setRuling({ largeTradeLimitUsd: String(s.largeTradeLimitUsd), firstResponseH: String(s.firstResponseH), appealWindowH: String(s.appealWindowH) });
  };
  const showPay = (p: PaySettings) => {
    setPay(p);
    setPayDraft(Object.fromEntries(PAY_FIELDS.map((f) => [f.field, payText(p[f.field], f.kind)])) as Record<PayField, string>);
  };

  useEffect(() => {
    fetchSettings().then(
      (s) => showRuling({ largeTradeLimitUsd: s.largeTradeLimitUsd, firstResponseH: s.firstResponseH, appealWindowH: s.appealWindowH }),
      (e: unknown) => setFault(faultText(e, 'X2F could not load the settings just now. Reload to try again.')),
    );
    fetchPay().then(showPay, (e: unknown) => setFault(faultText(e, 'X2F could not load the settings just now. Reload to try again.')));
  }, []);

  // What the fields say, read; and which fields do not read as an allowed value.
  const invalid: string[] = [];
  const nextRuling = {} as RulingSettings;
  for (const f of RULING_FIELDS) {
    const v = wholeOf(ruling[f.field]);
    const [lo, hi] = RULING_BOUNDS[f.field];
    if (v === null || v < lo || v > hi) invalid.push(`${f.label} (${lo.toLocaleString('en-US')} to ${hi.toLocaleString('en-US')} ${f.unit === 'hours' ? 'hours' : 'USD'})`);
    else nextRuling[f.field] = v;
  }
  const nextPay = {} as PaySettings;
  for (const f of PAY_FIELDS) {
    const v = payOf(payDraft[f.field], f.kind);
    if (v === undefined || (v !== null && (v < f.min || v > f.max))) invalid.push(f.label);
    else nextPay[f.field] = v;
  }
  const ok = invalid.length === 0 && stored !== null && pay !== null;
  const rulingChange: Partial<RulingSettings> = {};
  if (ok) for (const f of RULING_FIELDS) if (nextRuling[f.field] !== stored[f.field]) rulingChange[f.field] = nextRuling[f.field];
  const payChanged = ok && PAY_FIELDS.some((f) => nextPay[f.field] !== pay[f.field]);
  const changed = Object.keys(rulingChange).length > 0 || payChanged;

  const fail = (e: unknown) => {
    const r = refusalOf(e);
    if (r !== null) setRefusal(r);
    else setFault(faultText(e, 'The settings were not saved. Try again.'));
  };

  const savePay = async (tapId: string) => {
    try {
      showPay(await putPaySettings(nextPay, tapId));
      setSaved(true);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const payStep = (): Step => ({
    intent: { kind: 'pay-settings', ...nextPay },
    title: 'Change staff pay',
    body: 'Tap your security key to save the new pay amounts.',
    run: savePay,
  });

  /** After the rulings are saved (or when only pay changed): pay, if it changed, with its own tap. */
  const thenPay = () => {
    if (payChanged) setStep(payStep());
    else {
      setSaved(true);
      setBusy(false);
    }
  };

  const saveRuling = async (tapId: string | undefined) => {
    try {
      const s = await putSettings(rulingChange, tapId);
      showRuling({ largeTradeLimitUsd: s.largeTradeLimitUsd, firstResponseH: s.firstResponseH, appealWindowH: s.appealWindowH });
      thenPay();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  const save = () => {
    if (!ok || !changed) return;
    setBusy(true);
    setFault(null);
    setSaved(false);
    if (Object.keys(rulingChange).length === 0) {
      thenPay();
      return;
    }
    if (rulingChange.largeTradeLimitUsd !== undefined || rulingChange.appealWindowH !== undefined) {
      setStep({
        intent: { kind: 'settings', largeTradeLimitUsd: nextRuling.largeTradeLimitUsd, firstResponseH: nextRuling.firstResponseH, appealWindowH: nextRuling.appealWindowH },
        title: 'Change the ruling settings',
        body: 'The large-trade limit and the appeal window bind every ruling. Tap your security key to save them.',
        run: saveRuling,
      });
      return;
    }
    void saveRuling(undefined);
  };

  const input = (id: string, value: string, onChange: (v: string) => void, placeholder?: string) => (
    <input id={id} type="text" inputMode="decimal" className="x2f-input x2f-staff-number" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );

  return (
    <section data-screen="staff-settings" className="x2f-staff-narrow">
      <PageTitle title="Settings">
        <p className="x2f-staff-page__lead">Only the owner can change these. Every change is recorded in the activity log.</p>
      </PageTitle>
      {fault !== null ? (
        <Notice tone="danger" data-part="settings-fault">
          {fault}
        </Notice>
      ) : null}
      <section aria-label="Rulings" className="x2f-staff-card x2f-stack">
        <h2 className="x2f-h2">Rulings</h2>
        {RULING_FIELDS.map((f) => (
          <div key={f.field} className="x2f-staff-setting">
            <label htmlFor={`${ids}-${f.field}`} className="x2f-staff-setting__label">
              {f.label}
            </label>
            <span className="x2f-staff-setting__value">
              {input(`${ids}-${f.field}`, ruling[f.field], (v) => setRuling((r) => ({ ...r, [f.field]: v })))}
              <span className="x2f-staff-hint">{f.unit}</span>
            </span>
            <span className="x2f-staff-hint">{f.help}</span>
          </div>
        ))}
      </section>
      <section aria-label="Staff pay" className="x2f-staff-card x2f-stack">
        <div className="x2f-stack">
          <h2 className="x2f-h2">Staff pay</h2>
          {/* COPY-UNSIGNED: Task 33 as built (per completed dispute, at a correct clock-out); the board's "Paid monthly" line is out of date. */}
          <span className="x2f-staff-hint">Paid in XMR when staff clock out correctly, for each dispute they completed. Amounts to be decided; check with the lawyer before the first payment.</span>
        </div>
        {PAY_FIELDS.map((f) => (
          <div key={f.field} className="x2f-staff-setting">
            <label htmlFor={`${ids}-${f.field}`} className="x2f-staff-setting__label">
              {f.label}
            </label>
            <span className="x2f-staff-setting__value">
              {input(`${ids}-${f.field}`, payDraft[f.field], (v) => setPayDraft((p) => ({ ...p, [f.field]: v })), 'Not set')}
              <span className="x2f-staff-hint">{f.unit}</span>
            </span>
            <span className="x2f-staff-hint">{f.help}</span>
          </div>
        ))}
      </section>
      {invalid.length > 0 && stored !== null && pay !== null ? (
        // not-a-refusal: an input check naming the fields to fix.
        <Notice tone="danger" data-part="settings-invalid">{`Check these: ${invalid.join('; ')}.`}</Notice>
      ) : null}
      {saved ? (
        <Notice tone="plain" data-part="settings-saved">
          Saved.
        </Notice>
      ) : null}
      <div>
        <Button variant="primary" disabled={busy || !ok || !changed} onClick={save}>
          Save settings
        </Button>
      </div>
      {/* Spec 6.6 "Settings": each section below loads and saves on its own (no board draws them). */}
      <StarterLimitsSection />
      <LinksSection />
      <FeeSweepSection />
      <StaffPaySection />
      {step !== null ? (
        <KeyTapDialog
          intent={step.intent}
          title={step.title}
          body={step.body}
          onDone={(tapId) => {
            const s = step;
            setStep(null);
            void s.run(tapId);
          }}
          onCancel={() => {
            setStep(null);
            setBusy(false);
          }}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </section>
  );
}

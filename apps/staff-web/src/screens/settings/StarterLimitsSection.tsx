import { STARTER_BOUNDS, STARTER_FIELDS, starterInBounds, starterLimitsProblem, type KeyTapIntent, type StarterField, type StarterSettings } from '@x2f/staff';
import { useEffect, useState } from 'react';
import { putStarterLimits, starterLimits, type StarterLimitsView } from '../../api.js';
import { faultText, type StaffRefusal } from '../../refusals.js';
import { CantDoThat } from '../../ui/kit.js';
import { KeyTapDialog } from '../../ui/KeyTapDialog.js';
import { failureOf, SectionFoot, SettingField, SettingsCard } from './sectionKit.js';

/**
 * Spec 6.6 "Settings" and 2.3 (owner 2026-10-24): the starter limits, the defaults every new
 * trader starts on (`GET`/`PUT /staff/v1/starter-limits`). Every number is saved together with a
 * `starter-limits` tap of all of them (apps/api/src/staff/starterLimits.ts), and each change is
 * logged. The bounds and the order between stages are `@x2f/staff`'s, the same the API checks.
 * Words: COPY-UNSIGNED (all of C).
 */
const C = {
  title: 'Starter limits',
  lead: 'New accounts start on Starter and move up as they complete trades. Ad posters can still be stricter. Every change is recorded in the activity log.',
  fields: {
    starterCapUsd: { label: 'Starter: largest trade', unit: 'USD equivalent', help: 'The biggest single trade a Starter account can be part of, as buyer or seller.' },
    starterMaxOpenTrades: { label: 'Starter: open trades at once', unit: 'trades', help: 'How many trades a Starter account can have open at the same time.' },
    buildingCapUsd: { label: 'Building: largest trade', unit: 'USD equivalent', help: 'The biggest single trade once an account reaches Building.' },
    buildingMinTrades: { label: 'Building from', unit: 'completed trades', help: 'Completed trades an account needs to reach Building.' },
    buildingMinDays: { label: 'Building: account age', unit: 'days', help: 'How old the account must be to reach Building.' },
    graduatedMinTrades: { label: 'Graduated from', unit: 'completed trades', help: 'Completed trades for Graduated, which has no platform cap. The New badge shows until then.' },
    graduatedMinDays: { label: 'Graduated: account age', unit: 'days', help: 'How old the account must be to graduate.' },
  } satisfies Record<StarterField, { label: string; unit: string; help: string }>,
  bounds: (label: string, lo: number, hi: number) => `${label} (a whole number from ${lo.toLocaleString('en-US')} to ${hi.toLocaleString('en-US')})`,
  order: {
    buildingCapUsd: "Building's largest trade (at least Starter's)",
    graduatedMinTrades: "Graduated's completed trades (at least Building's)",
    graduatedMinDays: "Graduated's account age (at least Building's)",
  } as Partial<Record<StarterField, string>>,
  save: 'Save starter limits',
  tapTitle: 'Change the starter limits',
  tapBody: 'These decide how big a trade a new account can be part of. Tap your security key to save them.',
  loadFault: 'X2F could not load the starter limits just now. Reload to try again.',
  saveFault: 'The starter limits were not saved. Try again.',
} as const;

const empty = (): Record<StarterField, string> => Object.fromEntries(STARTER_FIELDS.map((f) => [f, ''])) as Record<StarterField, string>;

/** A whole number as typed ("1,000" reads 1000); null when it is not one. */
function wholeOf(s: string): number | null {
  const t = s.replace(/,/g, '').trim();
  return /^\d{1,12}$/.test(t) ? Number(t) : null;
}

export function StarterLimitsSection() {
  const [stored, setStored] = useState<StarterLimitsView | null>(null);
  const [draft, setDraft] = useState<Record<StarterField, string>>(empty);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [tap, setTap] = useState<StarterSettings | null>(null);

  const show = (v: StarterLimitsView) => {
    setStored(v);
    setDraft(Object.fromEntries(STARTER_FIELDS.map((f) => [f, String(v[f])])) as Record<StarterField, string>);
  };
  useEffect(() => {
    starterLimits().then(show, (e: unknown) => setFault(faultText(e, C.loadFault)));
  }, []);

  const problems: string[] = [];
  const next = {} as StarterSettings;
  for (const f of STARTER_FIELDS) {
    const v = wholeOf(draft[f]);
    const [lo, hi] = STARTER_BOUNDS[f];
    if (v === null || !starterInBounds(f, v)) problems.push(C.bounds(C.fields[f].label, lo, hi));
    else next[f] = v;
  }
  if (problems.length === 0) {
    const p = starterLimitsProblem(next);
    if (p !== null) problems.push(p.why === 'order' ? (C.order[p.field] ?? C.fields[p.field].label) : C.fields[p.field].label);
  }
  const changed = stored !== null && STARTER_FIELDS.some((f) => next[f] !== stored[f]);
  const canSave = stored !== null && problems.length === 0 && changed;

  const save = async (s: StarterSettings, tapId: string) => {
    try {
      show(await putStarterLimits(s, tapId));
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
    <SettingsCard label={C.title} lead={C.lead} part="starter-limits">
      {STARTER_FIELDS.map((f) => (
        <SettingField
          key={f}
          label={C.fields[f].label}
          unit={C.fields[f].unit}
          help={C.fields[f].help}
          value={draft[f]}
          onChange={(v) => {
            setSaved(false);
            setDraft((d) => ({ ...d, [f]: v }));
          }}
        />
      ))}
      <SectionFoot
        part="starter-limits"
        problems={stored === null ? [] : problems}
        fault={fault}
        saved={saved}
        updatedAt={stored?.updatedAt ?? null}
        saveLabel={C.save}
        canSave={canSave}
        busy={busy}
        onSave={() => {
          if (!canSave) return;
          setBusy(true);
          setFault(null);
          setSaved(false);
          setTap({ ...next });
        }}
      />
      {tap !== null ? (
        <KeyTapDialog
          intent={{ kind: 'starter-limits', ...tap } as KeyTapIntent}
          title={C.tapTitle}
          body={C.tapBody}
          onDone={(tapId) => {
            const s = tap;
            setTap(null);
            void save(s, tapId);
          }}
          onCancel={() => {
            setTap(null);
            setBusy(false);
          }}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </SettingsCard>
  );
}

import { formatXmrExact } from '@x2f/trade';
import { useEffect, useState } from 'react';
import { codeOf, feeSweep, putFeeSweep, type FeeSweepChange, type FeeSweepView } from '../../api.js';
import { faultText, type StaffRefusal } from '../../refusals.js';
import { CantDoThat, Notice } from '../../ui/kit.js';
import { KeyTapDialog } from '../../ui/KeyTapDialog.js';
import { utcMinuteText } from '../staffFormat.js';
import { failureOf, SectionFoot, SettingField, SettingsCard } from './sectionKit.js';

/**
 * B-006 / Plan 4 Task 9 (owner 2026-10-29 q7): the fee wallet's automatic sweep to the owner's cold
 * wallet (`GET`/`PUT /staff/v1/fee-sweep`, apps/api/src/staff/feeSweep.ts). The three values are
 * saved together with a `fee-sweep` tap bound to exactly them; an empty threshold turns the sweep
 * off. The checks mirror `parseFeeSweepChange`: amounts in XMR to the atomic unit, a threshold
 * needs the float and the cold address and must be above the float; the API checks the address is
 * a valid standard address on its network (400 `address-invalid`). The send itself waits on Plan 6
 * (`walletWired` false), which the section says. NEEDS_DESIGN_FEE_WALLET: no board draws it.
 * Words: COPY-UNSIGNED (all of C).
 */
const C = {
  title: 'Fee wallet',
  lead: "X2F's fees collect in the online fee wallet. At the threshold, everything above the amount to keep moves to your offline wallet, and you get a notification.",
  threshold: { label: 'Move fees at', unit: 'XMR', help: 'When the fee wallet holds this much, the sweep runs. Leave it empty to turn the sweep off.', problem: 'Move fees at (an XMR amount above the amount to keep, up to 12 decimals)' },
  float: { label: 'Keep in the fee wallet', unit: 'XMR', help: 'One day plus one night of staff pay stays online.', problem: 'Keep in the fee wallet (an XMR amount, up to 12 decimals)' },
  cold: { label: 'Your offline wallet address', help: 'A standard Monero address (starting with 4). Only the address is stored here; its keys stay with you.', problem: 'Your offline wallet address (95 characters)' },
  needsBoth: 'Keep in the fee wallet and the offline address (both are needed while the sweep is on)',
  on: 'The sweep is on.',
  off: 'The sweep is off.',
  notWired: 'The fee wallet is not connected yet. When the threshold is reached you get a notification, and nothing moves until it is.',
  last: (at: string, amount: string, outcome: 'pending' | 'sent' | 'failed') =>
    `Last sweep ${utcMinuteText(at)}: ${amount} XMR, ${outcome === 'sent' ? 'sent' : outcome === 'failed' ? 'did not go through' : 'result not recorded yet'}.`,
  offPlaceholder: 'Off',
  notSet: 'Not set',
  save: 'Save fee wallet',
  tapTitle: 'Change the fee wallet sweep',
  tapBody: "This decides where X2F's fees go. Tap your security key to save it.",
  addressInvalid: 'That is not a valid Monero address on this network. Check it and try again.',
  loadFault: 'X2F could not load the fee wallet settings just now. Reload to try again.',
  saveFault: 'The fee wallet settings were not saved. Try again.',
} as const;

const COLD = /^[1-9A-HJ-NP-Za-km-z]{95}$/;

/** XMR as typed to atomic units (a decimal string); '' is not set (null); undefined when unreadable. */
export function atomicOf(typed: string): string | null | undefined {
  const t = typed.replace(/,/g, '').trim();
  if (t === '') return null;
  const m = /^(\d{1,18})(?:\.(\d{1,12}))?$/.exec(t);
  if (!m) return undefined;
  return (BigInt(m[1]!) * 1_000_000_000_000n + BigInt((m[2] ?? '').padEnd(12, '0'))).toString();
}

const xmrText = (atomic: string | null): string => (atomic === null ? '' : formatXmrExact(BigInt(atomic)).replace(/\.?0+$/, ''));

export function FeeSweepSection() {
  const [stored, setStored] = useState<FeeSweepView | null>(null);
  const [draft, setDraft] = useState({ threshold: '', float: '', cold: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [tap, setTap] = useState<FeeSweepChange | null>(null);

  const show = (v: FeeSweepView) => {
    setStored(v);
    setDraft({ threshold: xmrText(v.thresholdAtomic), float: xmrText(v.floatAtomic), cold: v.coldAddress ?? '' });
  };
  useEffect(() => {
    feeSweep().then(show, (e: unknown) => setFault(faultText(e, C.loadFault)));
  }, []);

  const problems: string[] = [];
  const thresholdAtomic = atomicOf(draft.threshold);
  const floatAtomic = atomicOf(draft.float);
  const coldTyped = draft.cold.trim();
  const coldAddress = coldTyped === '' ? null : COLD.test(coldTyped) ? coldTyped : undefined;
  if (floatAtomic === undefined) problems.push(C.float.problem);
  if (coldAddress === undefined) problems.push(C.cold.problem);
  if (thresholdAtomic === undefined || thresholdAtomic === '0') problems.push(C.threshold.problem);
  else if (thresholdAtomic !== null && floatAtomic !== undefined && coldAddress !== undefined) {
    if (floatAtomic === null || coldAddress === null) problems.push(C.needsBoth);
    else if (BigInt(thresholdAtomic) <= BigInt(floatAtomic)) problems.push(C.threshold.problem);
  }
  const next = problems.length === 0 ? ({ thresholdAtomic, floatAtomic, coldAddress } as FeeSweepChange) : null;
  const changed = stored !== null && next !== null && (next.thresholdAtomic !== stored.thresholdAtomic || next.floatAtomic !== stored.floatAtomic || next.coldAddress !== stored.coldAddress);

  const save = async (n: FeeSweepChange, tapId: string) => {
    try {
      show(await putFeeSweep(n, tapId));
      setSaved(true);
    } catch (e) {
      // not-a-refusal: the API's address check, an input check shown as a fault.
      if (codeOf(e) === 'address-invalid') setFault(C.addressInvalid);
      else {
        const f = failureOf(e, C.saveFault);
        if ('refusal' in f) setRefusal(f.refusal);
        else setFault(f.fault);
      }
    } finally {
      setBusy(false);
    }
  };

  const edit = (k: keyof typeof draft) => (v: string) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  return (
    <SettingsCard label={C.title} lead={C.lead} part="fee-sweep">
      {stored !== null ? (
        <>
          <p className="x2f-staff-state" data-part="fee-sweep-state" data-tone={stored.on ? 'ok' : undefined}>
            {stored.on ? C.on : C.off}
          </p>
          {!stored.walletWired ? (
            <Notice tone="caution" data-part="fee-sweep-not-wired">
              {C.notWired}
            </Notice>
          ) : null}
          {stored.lastSweep !== null ? (
            <span className="x2f-staff-hint" data-part="fee-sweep-last">
              {C.last(stored.lastSweep.at, xmrText(stored.lastSweep.amountAtomic), stored.lastSweep.outcome)}
            </span>
          ) : null}
        </>
      ) : null}
      <SettingField label={C.threshold.label} unit={C.threshold.unit} help={C.threshold.help} value={draft.threshold} onChange={edit('threshold')} placeholder={C.offPlaceholder} />
      <SettingField label={C.float.label} unit={C.float.unit} help={C.float.help} value={draft.float} onChange={edit('float')} placeholder={C.notSet} />
      <SettingField wide label={C.cold.label} help={C.cold.help} value={draft.cold} onChange={edit('cold')} placeholder={C.notSet} />
      <SectionFoot
        part="fee-sweep"
        problems={stored === null ? [] : problems}
        fault={fault}
        saved={saved}
        saveLabel={C.save}
        canSave={changed}
        busy={busy}
        onSave={() => {
          if (!changed || next === null) return;
          setBusy(true);
          setFault(null);
          setSaved(false);
          setTap(next);
        }}
      />
      {tap !== null ? (
        <KeyTapDialog
          intent={{ kind: 'fee-sweep', ...tap }}
          title={C.tapTitle}
          body={C.tapBody}
          labels={{ thresholdAtomic: 'move fees at, in atomic units', floatAtomic: 'keep, in atomic units', coldAddress: 'your offline wallet' }}
          onDone={(tapId) => {
            const n = tap;
            setTap(null);
            void save(n, tapId);
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

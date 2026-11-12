import { useEffect, useId, useState } from 'react';
import { addPayoutAddress, clockOut, clockOutSheet, codeOf, type ClockOutResult, type ClockOutSheet } from '../api.js';
import { faultText } from '../refusals.js';
import { KeyTapDialog } from './KeyTapDialog.js';
import { Button, Notice, Sheet } from './kit.js';

const ATOMIC_PER_XMR = 1_000_000_000_000n;

/** XMR with 6 places, truncated (never shows more than exists); a debt keeps its minus sign. */
export function xmrText(atomic: string): string {
  const v = BigInt(atomic);
  const abs = v < 0n ? -v : v;
  const frac = (abs % ATOMIC_PER_XMR).toString().padStart(12, '0').slice(0, 6);
  return `${v < 0n ? '-' : ''}${abs / ATOMIC_PER_XMR}.${frac} XMR`;
}

/** US cents as dollars ("$33.00", "-$33.00"). */
export function usdText(cents: string): string {
  const v = BigInt(cents);
  const abs = v < 0n ? -v : v;
  return `${v < 0n ? '-' : ''}$${(abs / 100n).toLocaleString('en-US')}.${(abs % 100n).toString().padStart(2, '0')}`;
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{95}$/;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/**
 * The clock-out sheet (Plan 4 Task 33, D-041 and D-045; owner 2026-10-29 lead calls q5): the
 * transparent total of every dispute completed since the last paid clock-out, a thank-you, and the
 * pre-approved address to send it to (confirm the shown one or pick another; adding one is a
 * security-key tap). "Clock out" is the only way staff are paid: logging out or closing the app is
 * not a clock-out. A clawback debt or a missing price pays nothing now and waits for the next
 * clock-out.
 *
 * NEEDS_DESIGN_CLOCK_OUT: no board yet (D-041 NOT DRAWN); built from the kit's Sheet.
 * DESIGNER-REVIEW. Every sentence here is draft copy. COPY-UNSIGNED
 */
export function ClockOut({ onDone, onCancel }: { onDone: (r: ClockOutResult) => void; onCancel: () => void }) {
  const textId = useId();
  const [sheet, setSheet] = useState<ClockOutSheet | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const load = async () => {
    try {
      const s = await clockOutSheet();
      setSheet(s);
      // The shown one is the newest address unless one is already chosen.
      setChosen((c) => (c !== null && s.addresses.some((a) => a.id === c) ? c : (s.addresses.at(-1)?.id ?? null)));
    } catch (e) {
      setFault(faultText(e, 'Your pay could not be worked out just now. Try again.'));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const confirm = async () => {
    setBusy(true);
    setFault(null);
    try {
      onDone(await clockOut(sheet!.quote, sheet!.due === 'pay' ? chosen : null));
    } catch (e) {
      const c = codeOf(e);
      // not-a-refusal: the figures moved since the sheet was shown (a wait, not a rule); show them again.
      if (c === 'quote-changed' || c === 'quote-expired') {
        await load();
        setFault('Your pay changed while this was open. Check the new total, then clock out.');
        return;
      }
      // not-a-refusal: an input check on the chosen address, shown as a fault.
      if (c === 'address-required' || c === 'address-unknown') setFault('Choose one of your payout addresses.');
      else setFault(faultText(e, 'The clock-out did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const added = async (address: string, tapId: string) => {
    setAdding(null);
    try {
      const a = await addPayoutAddress(address, tapId);
      setTyped('');
      setChosen(a.id);
      await load();
    } catch (e) {
      const c = codeOf(e);
      // not-a-refusal: input checks on a typed address.
      if (c === 'address-invalid') setFault('That is not a Monero address X2F can pay. Check it and try again.');
      else if (c === 'address-exists') setFault('That address is already one of yours.');
      else setFault(faultText(e, 'The address was not added. Try again.'));
    }
  };

  if (adding !== null) {
    const address = adding;
    return (
      <KeyTapDialog
        intent={{ kind: 'payout-address', address }}
        title="Add a payout address"
        body={`Tap your security key to approve ${short(address)} for your pay.`}
        onDone={(tapId) => void added(address, tapId)}
        onCancel={() => setAdding(null)}
      />
    );
  }

  return (
    <Sheet open title="Clock out" describedBy={textId} wide="dialog" onClose={onCancel}>
      <div className="x2f-stack" data-part="clock-out">
        {sheet === null ? (
          <p id={textId}>Working out your pay…</p>
        ) : (
          <>
            <ClockOutTotal sheet={sheet} id={textId} />
            {sheet.due === 'pay' ? (
              <fieldset className="x2f-stack" data-part="clock-out-addresses">
                <legend>Send it to</legend>
                {sheet.addresses.map((a) => (
                  <label key={a.id}>
                    <input type="radio" name="payout-address" checked={chosen === a.id} onChange={() => setChosen(a.id)} /> {short(a.address)}
                  </label>
                ))}
                <label>
                  Another address
                  <input className="x2f-input" value={typed} onChange={(e) => setTyped(e.currentTarget.value.trim())} spellCheck={false} autoComplete="off" />
                </label>
                <Button variant="quiet" disabled={!ADDRESS.test(typed)} onClick={() => setAdding(typed)}>
                  Add this address
                </Button>
              </fieldset>
            ) : null}
          </>
        )}
        {fault !== null ? (
          <Notice tone="danger" data-part="clock-out-fault">
            {fault}
          </Notice>
        ) : null}
        <Button variant="primary" disabled={busy || sheet === null || (sheet.due === 'pay' && chosen === null)} onClick={() => void confirm()}>
          {sheet?.due === 'pay' ? 'Send my pay and clock out' : 'Clock out'}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Not yet
        </Button>
      </div>
    </Sheet>
  );
}

function ClockOutTotal({ sheet, id }: { sheet: ClockOutSheet; id: string }) {
  const lines = [
    `${sheet.disputes} ${sheet.disputes === 1 ? 'dispute' : 'disputes'} completed since your last paid clock-out`,
    ...(sheet.largeTrades > 0 ? [`${sheet.largeTrades} large-trade ${sheet.largeTrades === 1 ? 'share' : 'shares'}`] : []),
    ...(sheet.clawbacks > 0 ? [`${sheet.clawbacks} taken back after a decision was overruled on appeal`] : []),
  ];
  let text: string;
  if (sheet.due === 'pay') {
    const parts = sheet.usdCents !== '0' ? ` (${usdText(sheet.usdCents)} at today's price${sheet.atomic !== '0' ? `, plus ${xmrText(sheet.atomic)}` : ''})` : '';
    // not-a-refusal: the owner's thank-you ("we couldn't do it without you", lead calls q5), not a rule.
    text = `You've earned ${xmrText(sheet.amountAtomic!)}${parts}. Thank you: we couldn't do it without you.`;
  } else if (sheet.due === 'owed') {
    text = `Nothing is paid this time: decisions overruled on appeal took back more than you earned since. The rest, ${xmrText((-BigInt(sheet.amountAtomic ?? '0')).toString())}, comes off your next pay.`;
  } else if (sheet.due === 'no-price') {
    // not-a-refusal: a fault (the price feed is down), and the pay waits; nothing is refused.
    text = 'The XMR price is not available just now, so your pay waits for your next clock-out. Nothing is lost.';
  } else {
    text = 'Nothing to pay since your last paid clock-out. Thank you for your time.';
  }
  return (
    <div className="x2f-stack" data-part="clock-out-total">
      <ul>
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p id={id} data-part="clock-out-text">
        {text}
      </p>
    </div>
  );
}

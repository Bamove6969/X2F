/**
 * FundFallback (Task 22): the QR code and copyable address, the fallback to "Open in <wallet>" on
 * a phone and the main content on a desktop (spec 2.2 step 5, 6.4 "Funding"). The QR code encodes
 * the same `monero:` link as the wallet button, and the amount here is exactly the amount that
 * link carries: the whole `sellerFundsAtomic` (plan Revision 2026-10-20), or the remainder after a
 * short payment this device has seen. With no amount this device can stand behind (`send` null:
 * the API reports a short payment the device has not seen yet) only the address is shown, so
 * nothing can carry the full amount a second time (review 2026-10-27, I1).
 */
import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { formatXmr } from '@x2f/trade';
import { Button } from '../../ui/Button.js';
import { exactXmr } from './fund.js';

/**
 * The QR code as one SVG path of its dark modules, with the standard 4-module quiet zone. Built
 * with `qrcode-generator`, the library Task 30's TOTP code uses (screens/settings/Qr.tsx), so the
 * web app ships one QR library: error-correction level M, the smallest version that fits.
 */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return { size: n + quiet * 2, d };
}

export type CopyWrite = (text: string) => Promise<void>;

const clipboardWrite: CopyWrite = (text) => navigator.clipboard.writeText(text);

/** What the QR code and "Copy amount" carry: the `monero:` link and its amount, and whether it is a remainder. */
export interface SendNow {
  uri: string;
  atomic: bigint;
  rest: boolean;
}

export function FundFallback({
  address,
  send,
  restAtomic,
  primary,
  write = clipboardWrite,
}: {
  address: string;
  /** Null: show the address only (no QR code, no amount to copy). */
  send: SendNow | null;
  /** With `send` null, the rest still owed as the API reports it, for display only. */
  restAtomic?: bigint;
  /** On a desktop (and whenever there is no wallet link) "Copy address" is the screen's one primary action. */
  primary: boolean;
  write?: CopyWrite;
}) {
  const uri = send?.uri ?? null;
  const qr = useMemo(() => (uri === null ? null : qrPath(uri)), [uri]);
  const [copied, setCopied] = useState<'address' | 'amount' | 'failed' | null>(null);
  const copy = (what: 'address' | 'amount') => {
    if (what === 'amount' && send === null) return;
    write(what === 'address' ? address : exactXmr(send!.atomic)).then(
      () => setCopied(what),
      () => setCopied('failed'),
    );
  };
  const rest = send === null || send.rest;
  const shown = send === null ? (restAtomic ?? 0n) : send.atomic;
  return (
    <section className="x2f-fund-fallback" aria-label="QR code or address" data-fund-fallback="" data-address-only={send === null ? 'true' : 'false'}>
      <p className="x2f-fund-exact">
        {rest ? 'Send the rest:' : 'Send exactly this amount:'} <span className="x2f-mono">{formatXmr(shown)} XMR</span>
      </p>
      {qr === null ? null : (
        <svg
          className="x2f-fund-qr"
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          role="img"
          aria-label="QR code with the escrow address and amount"
          data-qr=""
          shapeRendering="crispEdges"
        >
          <rect className="x2f-fund-qr__light" width={qr.size} height={qr.size} />
          <path className="x2f-fund-qr__dark" d={qr.d} />
        </svg>
      )}
      <p className="x2f-fund-address x2f-mono" data-escrow-address="">
        {address}
      </p>
      <div className="x2f-fund-copy">
        <Button variant={primary ? 'primary' : 'secondary'} onClick={() => copy('address')}>
          Copy address
        </Button>
        {send === null ? null : (
          <Button variant="secondary" onClick={() => copy('amount')}>
            Copy amount
          </Button>
        )}
      </div>
      <p className="x2f-fund-copied" role="status">
        {copied === 'address' ? 'Address copied.' : copied === 'amount' ? 'Amount copied.' : copied === 'failed' ? "Couldn't copy. Select the address and copy it yourself." : ''}
      </p>
    </section>
  );
}

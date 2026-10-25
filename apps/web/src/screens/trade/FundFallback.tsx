/**
 * FundFallback (Task 22): the QR code and copyable address, the fallback to "Open in <wallet>" on
 * a phone and the main content on a desktop (spec 2.2 step 5, 6.4 "Funding"). The QR code encodes
 * the same `monero:` link as the wallet button, and every amount here is exactly
 * `sellerFundsAtomic` (plan Revision 2026-10-20).
 */
import { useMemo, useState } from 'react';
import * as QRCode from 'qrcode';
import { formatXmr } from '@x2f/trade';
import { Button } from '../../ui/Button.js';
import { exactXmr } from './fund.js';

/** The QR code as one SVG path of its dark modules, with the standard 4-module quiet zone. */
export function qrPath(text: string): { size: number; d: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 4;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return { size: n + quiet * 2, d };
}

export type CopyWrite = (text: string) => Promise<void>;

const clipboardWrite: CopyWrite = (text) => navigator.clipboard.writeText(text);

export function FundFallback({
  uri,
  address,
  sellerFundsAtomic,
  primary,
  write = clipboardWrite,
}: {
  uri: string;
  address: string;
  sellerFundsAtomic: bigint;
  /** On a desktop "Copy address" is the screen's one primary action. */
  primary: boolean;
  write?: CopyWrite;
}) {
  const qr = useMemo(() => qrPath(uri), [uri]);
  const [copied, setCopied] = useState<'address' | 'amount' | 'failed' | null>(null);
  const copy = (what: 'address' | 'amount') => {
    write(what === 'address' ? address : exactXmr(sellerFundsAtomic)).then(
      () => setCopied(what),
      () => setCopied('failed'),
    );
  };
  return (
    <section className="x2f-fund-fallback" aria-label="QR code or address" data-fund-fallback="">
      <p className="x2f-fund-exact">
        Send exactly this amount: <span className="x2f-mono">{formatXmr(sellerFundsAtomic)} XMR</span>
      </p>
      <svg
        className="x2f-qr"
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        role="img"
        aria-label="QR code with the escrow address and amount"
        data-qr=""
        shapeRendering="crispEdges"
      >
        <rect className="x2f-qr__light" width={qr.size} height={qr.size} />
        <path className="x2f-qr__dark" d={qr.d} />
      </svg>
      <p className="x2f-fund-address x2f-mono" data-escrow-address="">
        {address}
      </p>
      <div className="x2f-fund-copy">
        <Button variant={primary ? 'primary' : 'secondary'} onClick={() => copy('address')}>
          Copy address
        </Button>
        <Button variant="secondary" onClick={() => copy('amount')}>
          Copy amount
        </Button>
      </div>
      <p className="x2f-fund-copied" role="status">
        {copied === 'address' ? 'Address copied.' : copied === 'amount' ? 'Amount copied.' : copied === 'failed' ? "Couldn't copy. Select the address and copy it yourself." : ''}
      </p>
    </section>
  );
}

// @vitest-environment happy-dom
// Plan 5 Task 16: the seller's smart proof card (SellerConfirm board, "Payment proof"). The card
// fetches and decrypts the buyer's blurred copy through ChatProof, ProofThumb runs the receive check,
// and THIS device's OCR reads the redrawn copy (receive.ts `readWords`); `checkProof` and
// `proofCardLines` turn the words into the board's lines. The card informs only: it never unlocks
// the release.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { crc32, deflateSync } from 'node:zlib';
import { encryptProof, newProofId, proofKeyToBase64, readImageHeader, type OcrWord, type ProofAttachedPayload, type ProofExpected, type ReceiveDeps } from '@x2f/proof';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSnapshot } from '../src/chat/engine.js';
import { showableProof } from '../src/proof/receive.js';
import { sellerProofOfSnapshot, setSellerProofSource } from '../src/proof/sellerProof.js';
import { SellerProofSlot, SmartProofCard, checkedLine, checkingLine } from '../src/screens/proof/SmartProofCard.js';
import { SellerConfirm } from '../src/screens/trade/SellerConfirm.js';
import type { ReleaseEscrow, ReleaseTrade } from '../src/screens/trade/release/view.js';
import { render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const NOW = new Date('2026-10-16T20:00:00Z');
const DAY = 86_400_000;
const EXPECTED: ProofExpected = { fiatCents: 41250n, currency: 'USD', exponent: 2, tradeCode: CODE, earliest: new Date(Date.parse('2026-10-16T12:00:00Z') - DAY), latest: NOW };
const TRADE = { buyer: 'mira.k', total: '$412.50', code: CODE, currency: 'USD', exponent: 2 };
const CLOSING = 'Look for a $412.50 payment with the note K7M2-9QXA-4FTR-8WPN in your bank. Screenshot checks catch mistakes, but only your bank proves the money arrived.';

/** Synthetic OCR output: one string per line (as packages/proof/test/ocr.ts). */
function ocr(...lines: string[]): OcrWord[] {
  const out: OcrWord[] = [];
  lines.forEach((text, line) => {
    let col = 0;
    for (const part of text.split(' ')) {
      if (part.length > 0) out.push({ text: part, x0: col * 10, y0: line * 20, x1: (col + part.length) * 10, y1: line * 20 + 16, line, conf: 90 });
      col += part.length + 1;
    }
  });
  return out;
}
const receipt = (amount = '$412.50') => ocr('Zelle', 'Payment sent', amount, 'From:', `Memo ${CODE}`, 'Oct 16, 2026 at 2:14 PM');

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(latin1(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function png(w: number, h: number): Uint8Array {
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  head[8] = 8;
  head[9] = 2;
  const raw = new Uint8Array(h * (1 + 3 * w)).fill(7);
  for (let y = 0; y < h; y++) raw[y * (1 + 3 * w)] = 0;
  return Buffer.concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

async function made(o: { kind?: 'proof' | 'evidence'; hidden?: ProofAttachedPayload['hidden'] } = {}): Promise<{ payload: ProofAttachedPayload; ciphertext: Uint8Array }> {
  const kind = o.kind ?? 'proof';
  const proofId = newProofId();
  const { ciphertext, key, sha256 } = await encryptProof(png(4, 3), { code: CODE, proofId, kind });
  return { ciphertext, payload: { proofId, kind, key: await proofKeyToBase64(key), sha256, width: 4, height: 3, mime: 'image/png', hidden: o.hidden ?? ['name'], photoTakenAt: null } };
}

type Deps = ReceiveDeps & { readWords?: (png: Uint8Array, w: number, h: number) => Promise<OcrWord[] | null>; read: ReturnType<typeof vi.fn> };
/** The receive check's parts, and an OCR that answers `words` (or throws). */
function deps(words: OcrWord[] | null | 'throw' | 'none'): Deps {
  const read = vi.fn(async () => {
    if (words === 'throw') throw new Error('ocr died');
    return words === 'none' ? null : words;
  });
  const d = {
    decode: async (bytes: Uint8Array) => ({ ...readImageHeader(bytes), close: () => undefined }),
    render: async () => png(4, 3),
    read,
  } as Deps;
  if (words !== 'none') d.readWords = read as unknown as NonNullable<Deps['readWords']>;
  return d;
}

function serve(ciphertext: Uint8Array | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (ciphertext === null ? new Response('nope', { status: 500 }) : new Response(new Uint8Array(ciphertext), { status: 200, headers: { 'content-type': 'application/octet-stream' } }))),
  );
}

async function until(host: ParentNode, ok: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out; card says: ${host.textContent}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}
const checkedCard = (host: ParentNode) => host.querySelector('[data-part="smart-proof"][data-state="checked"]') !== null;
const lineTexts = (host: ParentNode) => [...host.querySelectorAll('[data-part="smart-proof-line"]')].map((e) => [e.getAttribute('data-tone'), e.textContent]);

afterEach(() => {
  vi.unstubAllGlobals();
  setSellerProofSource(null);
});

describe('SmartProofCard: the seller checks the screenshot on their own device', () => {
  it('the board example: the three board lines under "We checked mira.k\'s screenshot", then the closing line', async () => {
    const { payload, ciphertext } = await made();
    serve(ciphertext);
    const d = deps(receipt());
    const { host } = render(<SmartProofCard tradeCode={CODE} proof={payload} trade={TRADE} expectedAt={() => EXPECTED} deps={d} />);
    expect(host.querySelector('[data-part="smart-proof-head"]')!.textContent).toBe(checkingLine('mira.k'));
    expect(host.querySelector('[data-part="smart-proof-closing"]')!.textContent).toBe(CLOSING);
    await until(host, () => checkedCard(host));
    expect(host.querySelector('[data-part="smart-proof-head"]')!.textContent).toBe("We checked mira.k's screenshot");
    expect(checkedLine('mira.k')).toBe("We checked mira.k's screenshot");
    expect(lineTexts(host)).toEqual([
      ['escrow', 'Shows $412.50, the right amount'],
      ['escrow', "Note says K7M2-9QXA-4FTR-8WPN, this trade's code"],
      ['caution', 'Sender name hidden by mira.k'],
    ]);
    expect(host.querySelector('[data-part="smart-proof-closing"]')!.textContent).toBe(CLOSING);
    // The OCR read the redrawn copy (a fresh PNG from this device), once, and the picture is shown.
    expect(d.read).toHaveBeenCalledTimes(1);
    const [pngArg, w, h] = d.read.mock.calls[0]! as [Uint8Array, number, number];
    expect([...pngArg.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect([w, h]).toEqual([4, 3]);
    expect(host.querySelector('[data-part="proof-image"]')).not.toBeNull();
    expect(host.querySelector('[data-part="proof-fake-disclaimer"]')).not.toBeNull();
  });

  it('$400 on the screenshot: the mismatch line, in caution', async () => {
    const { payload, ciphertext } = await made();
    serve(ciphertext);
    const { host } = render(<SmartProofCard tradeCode={CODE} proof={payload} trade={TRADE} expectedAt={() => EXPECTED} deps={deps(receipt('$400.00'))} />);
    await until(host, () => checkedCard(host));
    expect(lineTexts(host)[0]).toEqual(['caution', 'Shows $400.00, not $412.50']);
    expect(host.textContent).not.toContain('the right amount');
  });

  for (const [what, words] of [
    ['an unreadable image (too few words)', ocr('x')],
    ['an OCR that cannot run', 'none'],
    ['an OCR that throws', 'throw'],
  ] as const) {
    it(`${what}: "We couldn't read this screenshot", and the closing line`, async () => {
      const { payload, ciphertext } = await made();
      serve(ciphertext);
      const { host } = render(<SmartProofCard tradeCode={CODE} proof={payload} trade={TRADE} expectedAt={() => EXPECTED} deps={deps(words as OcrWord[] | 'none' | 'throw')} />);
      await until(host, () => checkedCard(host));
      expect(lineTexts(host)[0]).toEqual(['caution', "We couldn't read this screenshot"]);
      expect(host.textContent).not.toContain('the right amount');
      expect(host.querySelector('[data-part="smart-proof-closing"]')!.textContent).toBe(CLOSING);
    });
  }

  it('a proof that does not decrypt or check out is never read: "couldn\'t read", no OCR', async () => {
    const { payload } = await made();
    serve(null);
    const d = deps(receipt());
    const { host } = render(<SmartProofCard tradeCode={CODE} proof={payload} trade={TRADE} expectedAt={() => EXPECTED} deps={d} />);
    await until(host, () => checkedCard(host));
    expect(lineTexts(host)[0]).toEqual(['caution', "We couldn't read this screenshot"]);
    expect(host.textContent).not.toContain('the right amount');
    expect(d.read).not.toHaveBeenCalled();
    expect(host.querySelector('[data-part="proof-refused"]')).not.toBeNull();
  });

  it('a proof bound to another trade (the AAD) is refused and never read', async () => {
    const { payload, ciphertext } = await made();
    serve(ciphertext);
    const d = deps(receipt());
    const { host } = render(<SmartProofCard tradeCode="Q7M2-9QXA-4FTR-8WPN" proof={payload} trade={TRADE} expectedAt={() => EXPECTED} deps={d} />);
    await until(host, () => checkedCard(host));
    expect(d.read).not.toHaveBeenCalled();
    expect(lineTexts(host)[0]).toEqual(['caution', "We couldn't read this screenshot"]);
    expect(host.textContent).not.toContain('the right amount');
  });

  it('the closing line is there in every variant (and while reading)', async () => {
    for (const words of [receipt(), receipt('$1.00'), ocr('Zelle', 'Payment sent', '$412.50'), ocr()]) {
      const { payload, ciphertext } = await made({ hidden: [] });
      serve(ciphertext);
      const { host, unmount } = render(<SmartProofCard tradeCode={CODE} proof={payload} trade={TRADE} expectedAt={() => EXPECTED} deps={deps(words)} />);
      expect(host.querySelector('[data-part="smart-proof-closing"]')!.textContent).toBe(CLOSING);
      await until(host, () => checkedCard(host));
      expect(host.querySelector('[data-part="smart-proof-closing"]')!.textContent).toBe(CLOSING);
      unmount();
      vi.unstubAllGlobals();
    }
  });
});

describe('showableProof with onWords (receive.ts): only words come back, and only for a proof that checks out', () => {
  it('reads the redrawn copy after the check, and hands back the words', async () => {
    const d = deps(receipt());
    const got: unknown[] = [];
    const shown = await showableProof(png(4, 3), { mime: 'image/png', width: 4, height: 3 }, d, (w) => got.push(w));
    expect(shown.src.startsWith('data:image/png;base64,')).toBe(true);
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got[0]).toEqual(receipt());
  });

  it('no onWords: no OCR at all', async () => {
    const d = deps(receipt());
    await showableProof(png(4, 3), { mime: 'image/png', width: 4, height: 3 }, d);
    expect(d.read).not.toHaveBeenCalled();
  });

  it('a refused proof is never read', async () => {
    const d = deps(receipt());
    const got: unknown[] = [];
    await expect(showableProof(png(4, 3), { mime: 'image/png', width: 9, height: 3 }, d, (w) => got.push(w))).rejects.toThrow();
    expect(d.read).not.toHaveBeenCalled();
    expect(got).toEqual([]);
  });

  it('an answer that is not a word list reads as null', async () => {
    const d = deps(receipt());
    d.readWords = async () => 'oops' as unknown as OcrWord[];
    const got: unknown[] = [];
    await showableProof(png(4, 3), { mime: 'image/png', width: 4, height: 3 }, d, (w) => got.push(w));
    await vi.waitFor(() => expect(got).toEqual([null]));
  });
});

describe('sellerProofOfSnapshot: the buyer\'s newest payment proof', () => {
  const p = (proofId: string, kind: 'proof' | 'evidence' = 'proof') => ({ proofId, kind, key: 'k', sha256: 's', width: 1, height: 1, mime: 'image/png', hidden: [], photoTakenAt: null }) as ProofAttachedPayload;
  const snap = (lines: Array<Partial<ChatSnapshot['lines'][number]>>) => ({ phase: 'ready', more: false, lines }) as unknown as ChatSnapshot;
  it('newest by line id; never the seller\'s, evidence or a missing line', () => {
    expect(sellerProofOfSnapshot(null)).toBeNull();
    expect(
      sellerProofOfSnapshot(
        snap([
          { id: '2', from: 'buyer', proof: p('A') },
          { id: '10', from: 'buyer', proof: p('B') },
          { id: '11', from: 'seller', proof: p('S') },
          { id: '12', from: 'buyer', proof: p('E', 'evidence') },
          { id: '13', from: 'buyer', proof: p('M'), missing: true },
          { id: '14', from: 'buyer', text: 'hi' },
        ]),
      )?.proofId,
    ).toBe('B');
    expect(sellerProofOfSnapshot(snap([{ id: '1', from: 'seller', proof: p('S') }]))).toBeNull();
  });
});

// ---- SellerConfirm with the card: it never unlocks the release by itself. ----

const ZELLE = { name: 'Zelle', giftCard: false, whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.' };
const PROFILE = { id: 'ZELLE', whatItIs: ZELLE.whatItIs, landsIn: "your bank account, checked in your bank's app", checkPrompt: null, arrival: 'instant', confirmWindowMin: 120, fields: [] };
function view(): ReleaseTrade {
  return {
    code: CODE,
    role: 'seller',
    poster: 'seller',
    state: 'paid',
    counterparty: { tradeTag: 'mira.k', completedTrades: 3, online: true, lastSeenAt: NOW.toISOString(), typicalMinutes: null, positivePct: null, badges: [], stage: 'building' },
    methodId: 'ZELLE',
    profile: PROFILE,
    amountAtomic: '1250000000000',
    fiatCents: '41250',
    lockedRate: { currency: 'USD', centsPerXmr: '33000' },
    releasable: true,
    releasableEtaMin: 0,
    settling: null,
    txHash: null,
    confirmBy: '2026-10-16T21:52:00.000Z',
    securedAt: '2026-10-16T12:00:00.000Z',
    serverNow: NOW.toISOString(),
  } as ReleaseTrade;
}
const ESCROW: ReleaseEscrow = { release: async () => undefined, phase: 'ready', error: null, refusal: null, keepOpen: false, amountAtomic: 1250000000000n, fiatCents: 41250n } as ReleaseEscrow;

describe('SellerProofSlot on SellerConfirm', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  it('absent with the flag off, with no proof, or with no total on this device', async () => {
    const { payload } = await made();
    setSellerProofSource((_code, on) => {
      on(payload);
      return () => undefined;
    });
    for (const props of [
      { enabled: false, fiatCents: 41250n, total: '$412.50' },
      { enabled: true, fiatCents: null, total: '$412.50' },
      { enabled: true, fiatCents: 41250n, total: null },
    ]) {
      const { host, unmount } = render(<SellerProofSlot code={CODE} trade={view()} clock={() => NOW} {...props} />);
      expect(host.querySelector('[data-part="smart-proof"]'), JSON.stringify(props, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).toBeNull();
      unmount();
    }
    setSellerProofSource((_code, on) => {
      on(null);
      return () => undefined;
    });
    const { host } = render(<SellerProofSlot code={CODE} trade={view()} clock={() => NOW} enabled fiatCents={41250n} total="$412.50" />);
    expect(host.querySelector('[data-part="smart-proof"]')).toBeNull();
  });

  it('an all-good card leaves the hold locked until the seller ticks the box', async () => {
    const { payload, ciphertext } = await made();
    serve(ciphertext);
    setSellerProofSource((_code, on) => {
      on(payload);
      return () => undefined;
    });
    const slot = <SmartProofCard tradeCode={CODE} proof={payload} trade={TRADE} expectedAt={() => EXPECTED} deps={deps(receipt())} />;
    const { host } = render(
      <MemoryRouter>
        <SellerConfirm escrowCode={CODE} trade={view()} method={ZELLE as never} escrow={ESCROW} onTrade={() => undefined} proofSlot={slot} serverClock={() => NOW} />
      </MemoryRouter>,
    );
    await until(host, () => checkedCard(host));
    expect(lineTexts(host).map(([, t]) => t)).toContain('Shows $412.50, the right amount');
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    const hold = host.querySelector<HTMLButtonElement>('button[data-primary]')!;
    expect(hold.disabled).toBe(true);
    await act(async () => box.click());
    expect(host.querySelector<HTMLButtonElement>('button[data-primary]')!.disabled).toBe(false);
  });
});

// Fixture mode: `VITE_FIXTURES=1` in a non-production build only (vite.config.ts drops it from
// production). The boards' example data is in boards.ts; each screen task answers its own API calls from it.
import { createElement, useSyncExternalStore } from 'react';
import type { ProofAttachedPayload } from '@x2f/proof';
import { setSellerProofSource } from '../proof/sellerProof.js';
import { PENDING_ESCROW, setTradeEscrowHook, type TradeEscrow } from '../screens/trade/seams.js';
import { BOARD_TRADE } from './boards.js';
import { installPayFixtures } from './payChat.js';

declare global {
  interface Window {
    /**
     * Fixture builds only: the escrow state the trade room shows in place of Task 12's runtime
     * (fixture builds have no relay, node or moderator). Playwright sets it with addInitScript;
     * see e2e/fund.spec.ts and e2e/refund.spec.ts.
     */
    __x2fFixtureEscrow?: Partial<Pick<TradeEscrow, 'phase' | 'error' | 'retryable' | 'refusal' | 'checkWords' | 'keepOpen' | 'escrowAddress'>> & {
      /** The device's deal, with the take amount as a decimal string (bigints don't cross addInitScript); currency, rate and maximum are the board trade's. */
      deal?: { poster: 'seller' | 'buyer'; takeAmountAtomic: string };
      /** What this device has seen arrive, as a decimal string; absent for no reading. */
      receivedAtomic?: string;
      /** The confirmed part of it, as a decimal string; absent for no reading. */
      confirmedAtomic?: string;
      /** The trade amount this device accepts and its fiat total, as decimal strings; absent for none. */
      amountAtomic?: string;
      fiatCents?: string;
    };
    /**
     * Fixture builds only: changes the fixture escrow's state while the page runs (a device whose
     * own figures follow a grown trade, a runtime that reports a refusal); amounts as decimal strings.
     */
    __x2fSetFixtureEscrow?: (patch: Partial<Pick<TradeEscrow, 'phase' | 'error' | 'retryable' | 'refusal' | 'keepOpen' | 'paidRecorded' | 'intentKind'>> & { amountAtomic?: string | null; fiatCents?: string | null }) => void;
    /** Fixture builds only: every escrow action the room asked for (`release`, `signal:trade.extend`, ...), in order. */
    __x2fEscrowCalls?: string[];
    /** Fixture builds only: while true, every escrow action is refused (a relay that is down). */
    __x2fEscrowFail?: boolean;
    /**
     * Fixture builds only: keep Task 20's real TradeChatPanel in the chat seam instead of the
     * board's stand-in (src/fixtures/payChat.tsx); e2e/chat.spec.ts sets it.
     */
    __x2fRealChat?: boolean;
    /**
     * Fixture builds only (Plan 5 Task 13, e2e/proof-ocr.spec.ts): runs the real `prepareProof` with
     * the browser deps (decode, the self-hosted OCR worker) on an image given as base64, and answers
     * what the editor would get. Nothing leaves the page.
     */
    __x2fProofLab?: (b64: string, mime: string, keep: { tradeCode: string; fiatCents: string; exponent: number }) => Promise<ProofLabResult>;
    /**
     * Fixture builds only (Plan 5 Task 16, e2e/proof-card.spec.ts): the buyer's payment proof line the
     * seller's chat would hold, in place of the chat; the card then fetches, decrypts, checks and reads
     * it for real.
     */
    __x2fFixtureSellerProof?: ProofAttachedPayload;
    /**
     * Fixture builds only (Plan 5 Task 13, e2e/proof-pipeline.spec.ts): the real upload pipeline on an
     * image given as base64, with the browser's own decoder and encoder (no OCR): `prepareProof`, then
     * `finishProof` with no regions (the bytes a proof would be encrypted from) and the unblurred
     * copy's `prepareUnblurred` + `finishProof`. Counts createImageBitmap calls. Nothing leaves the page.
     */
    __x2fProofPipeline?: (b64: string, mime: string) => Promise<ProofPipelineResult>;
  }
}

/** What `window.__x2fProofLab` answers: boxes in the prepared picture's pixels. */
export interface ProofLabResult {
  ocrOk: boolean;
  width: number;
  height: number;
  auto: Array<{ kind: string; x0: number; y0: number; x1: number; y1: number }>;
  amount: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  memo: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  words: string[];
  /** The OCR words with their boxes and lines (for the recall record, docs/security/plan-5-review.md). */
  ocr: Array<{ text: string; x0: number; y0: number; x1: number; y1: number; line: number }>;
  ms: number;
}

async function proofLab(b64: string, mime: string, keep: { tradeCode: string; fiatCents: string; exponent: number }): Promise<ProofLabResult> {
  const [{ prepareProof }, { browserProofImageDeps }] = await Promise.all([import('../proof/upload.js'), import('../proof/browserImage.js')]);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const t0 = performance.now();
  const p = await prepareProof(new Blob([bytes], { type: mime }), { tradeCode: keep.tradeCode, fiatCents: BigInt(keep.fiatCents), exponent: keep.exponent }, browserProofImageDeps());
  const box = ({ x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }) => ({ x0, y0, x1, y1 });
  return {
    ocrOk: p.ocrOk,
    width: p.width,
    height: p.height,
    auto: p.auto.map((r) => ({ kind: r.kind, ...box(r) })),
    amount: p.amount.map(box),
    memo: p.memo.map(box),
    words: p.words.map((w) => w.text),
    ocr: p.words.map((w) => ({ text: w.text, ...box(w), line: w.line })),
    ms: performance.now() - t0,
  };
}

/** What `window.__x2fProofPipeline` answers. */
export type ProofPipelineResult =
  | { ok: false; error: string; bitmaps: number }
  | {
      ok: true;
      bitmaps: number;
      width: number;
      height: number;
      /** RGBA of the four corners of the prepared picture: top-left, top-right, bottom-left, bottom-right. */
      corners: number[][];
      /** The cleaned bytes of the blurred copy and of the unblurred copy, base64, and their types. */
      proof: { b64: string; mime: string };
      unblurred: { b64: string; mime: string };
    };

const b64of = (bytes: Uint8Array): string => {
  let s = '';
  for (let at = 0; at < bytes.length; at += 0x8000) s += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(s);
};

async function proofPipeline(b64: string, mime: string): Promise<ProofPipelineResult> {
  const [{ ProofInputError, finishProof, prepareProof, prepareUnblurred }, { browserProofImageDeps }] = await Promise.all([import('../proof/upload.js'), import('../proof/browserImage.js')]);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const real = globalThis.createImageBitmap;
  let bitmaps = 0;
  globalThis.createImageBitmap = ((...a: Parameters<typeof createImageBitmap>) => {
    bitmaps++;
    return real(...a);
  }) as typeof createImageBitmap;
  try {
    const deps = { ...browserProofImageDeps(), ocr: async () => null };
    const keep = { tradeCode: 'K7M2-9QXA-4FTR-8WPN', fiatCents: 41250n, exponent: 2 };
    let p: Awaited<ReturnType<typeof prepareProof>>;
    try {
      p = await prepareProof(new Blob([bytes], { type: mime }), keep, deps);
    } catch (e) {
      return { ok: false, error: e instanceof ProofInputError ? e.code : String(e), bitmaps };
    }
    const px = (x: number, y: number) => [...p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];
    const corners = [px(0, 0), px(p.width - 1, 0), px(0, p.height - 1), px(p.width - 1, p.height - 1)];
    const fin = await finishProof(p, [], deps);
    const pic = await prepareUnblurred(new Blob([bytes], { type: mime }), deps);
    const un = await finishProof(pic, [], deps);
    return { ok: true, bitmaps, width: p.width, height: p.height, corners, proof: { b64: b64of(fin.bytes), mime: fin.mime }, unblurred: { b64: b64of(un.bytes), mime: un.mime } };
  } finally {
    globalThis.createImageBitmap = real;
  }
}

const big = (v: string | undefined): bigint | null => (v === undefined ? null : BigInt(v));

export function installFixtures(): void {
  document.documentElement.dataset.fixtureMode = 'on';
  window.__x2fProofLab = proofLab;
  window.__x2fProofPipeline = proofPipeline;
  const sellerProof = window.__x2fFixtureSellerProof;
  if (sellerProof !== undefined) {
    setSellerProofSource((_code, on) => {
      on(sellerProof);
      return () => undefined;
    });
  }
  installPayFixtures(window.__x2fRealChat === true);
  const escrow = window.__x2fFixtureEscrow;
  if (!escrow) return;
  const { deal, receivedAtomic, confirmedAtomic, amountAtomic, fiatCents, ...rest } = escrow;
  const calls: string[] = [];
  window.__x2fEscrowCalls = calls;
  const subs = new Set<() => void>();
  const set = (patch: Partial<TradeEscrow>): void => {
    state = { ...state, ...patch };
    for (const cb of subs) cb();
  };
  const record =
    (name: string, after?: () => void) =>
    async (): Promise<void> => {
      calls.push(name);
      if (window.__x2fEscrowFail) throw new Error('escrow action refused');
      after?.();
    };
  let state: TradeEscrow = {
    ...PENDING_ESCROW,
    ...rest,
    deal: deal
      ? { poster: deal.poster, takeAmountAtomic: BigInt(deal.takeAmountAtomic), currency: BOARD_TRADE.currency, centsPerXmr: BOARD_TRADE.rateCentsPerXmr, maxFiatCents: BOARD_TRADE.fiatCents }
      : null,
    receivedAtomic: big(receivedAtomic),
    confirmedAtomic: big(confirmedAtomic),
    amountAtomic: big(amountAtomic),
    fiatCents: big(fiatCents),
    release: async () => {
      await record('release')();
      set({ phase: 'done', keepOpen: false });
    },
    buildRefund: record('build-refund'),
    // Like Task 12's runtime: a tapped settle is saved on this device (intentKind).
    buyerCancel: record('buyer-cancel', () => set({ intentKind: 'buyer-cancel' })),
    proposeCancelSign: record('propose-cancel-sign', () => set({ intentKind: 'mutual-cancel' })),
    // Like Task 12's runtime: the buyer's own tap is recorded on this device (paidRecorded).
    markPaid: async (cents) => record(`paid:${cents}`, () => set({ paidRecorded: true, refusal: null }))(),
    signal: async (type) => record(`signal:${type}`)(),
  };
  window.__x2fSetFixtureEscrow = (patch) => {
    const { amountAtomic: a, fiatCents: f, ...other } = patch;
    set({ ...other, ...(a !== undefined ? { amountAtomic: a === null ? null : BigInt(a) } : {}), ...(f !== undefined ? { fiatCents: f === null ? null : BigInt(f) } : {}) });
  };
  setTradeEscrowHook(() =>
    useSyncExternalStore(
      (cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
      () => state,
    ),
  );
}

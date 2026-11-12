// @vitest-environment happy-dom
// Plan 5 Task 15: the blur editor ("Check your proof", no board yet: built from the kit, DESIGNER-REVIEW)
// and the Add payment proof screen around it. The pixels are the prepared proof's; the editor shows
// the regions over the picture, removes one on a tap, adds the buyer's own by dragging, shows the
// existing warnings (own blur over the amount or the memo, the date line, item 63 and 64's pop-ups),
// and hands the regions to the send. The privacy of the send itself is proofUpload.test.ts's.
import { type OcrWord, type ProofExpected } from '@x2f/proof';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EditorRegion, type PreparedProof, PROOF_CANT_USE, PROOF_NO_AUTO_CHECK } from '../src/proof/upload.js';
import { AddProof, PROOF_SENT } from '../src/screens/proof/AddProof.js';
import { BlurEditor, PROOF_BEST_EFFORT } from '../src/screens/proof/BlurEditor.js';
import { PROOF_AMOUNT_HIDDEN, PROOF_NO_AMOUNT, PROOF_NOT_CURRENT } from '../src/screens/proof/ProofPrompts.js';
import { fire, render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const NOW = new Date('2026-11-12T12:00:00Z');
const EXPECTED: ProofExpected = { fiatCents: 41250n, currency: 'USD', exponent: 2, tradeCode: CODE, earliest: new Date('2026-11-11T12:00:00Z'), latest: NOW };

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
const WORDS = ocr('Sent $412.50 on Nov 12, 2026', 'Card 4111 1111 1111 1111', '', 'jane@example.com', '', `Note ${CODE}`);
const AUTO: EditorRegion[] = [
  { id: 'a0', source: 'auto', kind: 'card', x0: 46, y0: 16, x1: 244, y1: 40 },
  { id: 'a1', source: 'auto', kind: 'email', x0: 0, y0: 56, x1: 164, y1: 80 },
];
const AMOUNT = [{ x0: 50, y0: 0, x1: 120, y1: 16 }];
const MEMO = [{ x0: 50, y0: 100, x1: 240, y1: 116 }];

function prepared(over: Partial<PreparedProof> = {}): PreparedProof {
  return { rgba: new Uint8ClampedArray(300 * 120 * 4), width: 300, height: 120, words: WORDS, ocrOk: true, auto: AUTO, amount: AMOUNT, memo: MEMO, photoTakenAt: null, ...over };
}

const $ = (host: HTMLElement, sel: string) => host.querySelector(sel);
const $$ = (host: HTMLElement, sel: string) => [...host.querySelectorAll(sel)];
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));
const textOf = (host: HTMLElement) => host.textContent ?? '';
function drag(el: Element, from: [number, number], to: [number, number]) {
  const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true };
  fire(el, new PointerEvent('pointerdown', { ...init, clientX: from[0], clientY: from[1] }));
  fire(el, new PointerEvent('pointermove', { ...init, clientX: to[0], clientY: to[1] }));
  fire(el, new PointerEvent('pointerup', { ...init, clientX: to[0], clientY: to[1] }));
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => vi.restoreAllMocks());

describe('BlurEditor', () => {
  it('shows each automatic region; a tap removes it; Send hands over the regions left', () => {
    const onSend = vi.fn();
    const { host } = render(<BlurEditor prepared={prepared()} expected={EXPECTED} onSend={onSend} onChooseAnother={() => undefined} />);
    expect(textOf(host)).toContain(PROOF_BEST_EFFORT);
    expect(textOf(host)).not.toContain(PROOF_NO_AUTO_CHECK);
    const regions = $$(host, '[data-part="blur-region"]');
    expect(regions.map((r) => r.getAttribute('data-source'))).toEqual(['auto', 'auto']);
    expect(regions[0]!.getAttribute('aria-label')).toBe('Remove blur');
    click(regions[1]!);
    expect($$(host, '[data-part="blur-region"]')).toHaveLength(1);
    click($(host, '[data-part="send-proof"]'));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect((onSend.mock.calls[0]![0] as EditorRegion[]).map((r) => r.id)).toEqual(['a0']);
    expect(onSend.mock.calls[0]![1]).toBeNull();
  });

  it('OCR unavailable: the no-check line, no regions, and never a claim that anything was blurred', () => {
    const { host } = render(<BlurEditor prepared={prepared({ ocrOk: false, auto: [], words: [], amount: [], memo: [] })} expected={EXPECTED} onSend={() => undefined} onChooseAnother={() => undefined} />);
    expect(textOf(host)).toContain(PROOF_NO_AUTO_CHECK);
    expect($$(host, '[data-part="blur-region"]')).toHaveLength(0);
    expect(textOf(host)).not.toMatch(/were blurred|we blurred|have been blurred/i);
  });

  it('Add blur, then a drag adds the buyer\'s own region; over the amount it warns (a warning only)', () => {
    const onSend = vi.fn();
    const { host } = render(<BlurEditor prepared={prepared()} expected={EXPECTED} onSend={onSend} onChooseAnother={() => undefined} />);
    expect($(host, '[data-part="proof-hidden-by-you"]')).toBeNull();
    click($(host, '[data-part="add-blur"]'));
    drag($(host, '[data-part="blur-surface"]')!, [40, 0], [130, 18]);
    const regions = $$(host, '[data-part="blur-region"]');
    expect(regions.map((r) => r.getAttribute('data-source'))).toEqual(['auto', 'auto', 'manual']);
    expect(textOf(host)).toContain(PROOF_AMOUNT_HIDDEN);
    click($(host, '[data-part="send-proof"]'));
    const sent = onSend.mock.calls[0]![0] as EditorRegion[];
    expect(sent[2]).toMatchObject({ source: 'manual', kind: 'manual', x0: 40, y0: 0, x1: 130, y1: 18 });
  });

  it('item 63: a screenshot dated outside the trade blocks the send; Redo proof chooses another', () => {
    const onSend = vi.fn();
    const onChooseAnother = vi.fn();
    const old = ocr('Sent $412.50 on Mar 3, 2025', `Note ${CODE}`);
    const { host } = render(<BlurEditor prepared={prepared({ words: old, auto: [] })} expected={EXPECTED} onSend={onSend} onChooseAnother={onChooseAnother} />);
    click($(host, '[data-part="send-proof"]'));
    expect(document.body.textContent).toContain(PROOF_NOT_CURRENT);
    expect(onSend).not.toHaveBeenCalled();
    click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Redo proof')!);
    expect(onChooseAnother).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('item 64: no amount found asks for an optional explanation, then sends', () => {
    const onSend = vi.fn();
    const { host } = render(<BlurEditor prepared={prepared({ words: ocr('Payment sent Nov 12, 2026', `Note ${CODE}`), auto: [] })} expected={EXPECTED} onSend={onSend} onChooseAnother={() => undefined} />);
    click($(host, '[data-part="send-proof"]'));
    expect(document.body.textContent).toContain(PROOF_NO_AMOUNT);
    expect(onSend).not.toHaveBeenCalled();
    click([...document.querySelectorAll('[data-popup="no-amount"] button')].find((b) => b.textContent === 'Send proof')!);
    expect(onSend).toHaveBeenCalledWith([], '');
  });

  it('owner G16: no date on the screenshot nor in the photo gives the date line, and posting stays allowed', () => {
    const onSend = vi.fn();
    const { host } = render(<BlurEditor prepared={prepared({ words: ocr('Sent $412.50', `Note ${CODE}`), auto: [] })} expected={EXPECTED} onSend={onSend} onChooseAnother={() => undefined} />);
    expect(textOf(host)).toContain("We couldn't detect the date of this proof.");
    click($(host, '[data-part="send-proof"]'));
    expect(onSend).toHaveBeenCalled();
  });

  it('shows the picture on a canvas only (no <img>, no URL of the picture)', () => {
    const { host } = render(<BlurEditor prepared={prepared()} expected={EXPECTED} onSend={() => undefined} onChooseAnother={() => undefined} />);
    expect($(host, 'canvas[data-part="blur-preview"]')).not.toBeNull();
    expect($(host, 'img')).toBeNull();
  });
});

describe('AddProof', () => {
  function file(): File {
    return new File([new Uint8Array([1, 2, 3])], 'IMG_0042-secret-name.png', { type: 'image/png' });
  }

  it('pick, check, send: the editor opens on the prepared proof and Send runs the send with its regions', async () => {
    const prepare = vi.fn(async () => prepared());
    const send = vi.fn(async () => ({ proofId: 'X', blur: 'auto' as const, hidden: [] }));
    const { host } = render(<AddProof code={CODE} expected={EXPECTED} prepare={prepare} send={send} />);
    const input = $(host, 'input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.accept).toBe('image/*');
    Object.defineProperty(input, 'files', { value: [file()] });
    fire(input, new Event('change', { bubbles: true }));
    await flush();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect($(host, '[data-part="blur-editor"]')).not.toBeNull();
    click($(host, '[data-part="send-proof"]'));
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [{ regions: EditorRegion[] }])[0].regions.map((r) => r.id)).toEqual(['a0', 'a1']);
    expect(textOf(host)).toContain(PROOF_SENT);
    // The file's name is never shown or sent.
    expect(textOf(host)).not.toContain('IMG_0042');
    expect(JSON.stringify(send.mock.calls)).not.toContain('IMG_0042');
  });

  it("a file that can't be used says so, and Choose another goes back to the picker", async () => {
    const { ProofInputError } = await import('../src/proof/upload.js');
    const { host } = render(<AddProof code={CODE} expected={EXPECTED} prepare={async () => { throw new ProofInputError('too-large'); }} send={vi.fn()} />);
    const input = $(host, 'input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file()] });
    fire(input, new Event('change', { bubbles: true }));
    await flush();
    expect(textOf(host)).toContain(PROOF_CANT_USE);
    expect($(host, '[data-part="blur-editor"]')).toBeNull();
  });

  it('a failed send keeps the editor open with an error, and does not claim the proof was sent', async () => {
    const { host } = render(<AddProof code={CODE} expected={EXPECTED} prepare={async () => prepared()} send={async () => { throw new Error('refused'); }} />);
    const input = $(host, 'input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file()] });
    fire(input, new Event('change', { bubbles: true }));
    await flush();
    click($(host, '[data-part="send-proof"]'));
    await flush();
    expect($(host, '[data-part="blur-editor"]')).not.toBeNull();
    expect(textOf(host)).not.toContain(PROOF_SENT);
    expect($(host, '[data-part="proof-send-error"]')).not.toBeNull();
  });
});

describe('BuyerPay proof slot wiring', () => {
  it('proofExpectedOf: the trade total in cents, from the day before it was secured to now; null before the device knows the total', async () => {
    const { proofExpectedOf } = await import('../src/screens/proof/proofSlot.js');
    const e = proofExpectedOf({ code: CODE, securedAt: '2026-11-12T10:00:00.000Z', lockedRate: { currency: 'USD', centsPerXmr: '1' } }, { fiatCents: 41250n, deal: null }, NOW);
    expect(e).toEqual({ fiatCents: 41250n, currency: 'USD', exponent: 2, tradeCode: CODE, earliest: new Date('2026-11-11T10:00:00.000Z'), latest: NOW });
    expect(proofExpectedOf({ code: CODE, securedAt: null, lockedRate: { currency: 'USD', centsPerXmr: '1' } }, { fiatCents: null, deal: null }, NOW)).toBeNull();
  });

  it('flag off (the default): the board slot stays disabled; on: the picker is live and a sent proof marks the trade attached', async () => {
    const { ProofSlotLive } = await import('../src/screens/proof/proofSlot.js');
    const { proofStateOf, setProofSource } = await import('../src/screens/trade/paySeams.js');
    const off = render(<ProofSlotLive enabled={false} code={CODE} expected={EXPECTED} wide={false} />);
    expect((off.host.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
    off.unmount();
    const on = render(<ProofSlotLive enabled code={CODE} expected={EXPECTED} wide={false} prepare={async () => prepared()} send={async () => ({})} />);
    const input = on.host.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(proofStateOf(CODE)).not.toBe('attached');
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(3)], 'x.png')] });
    fire(input, new Event('change', { bubbles: true }));
    await flush();
    click(on.host.querySelector('[data-part="send-proof"]'));
    await flush();
    expect(proofStateOf(CODE)).toBe('attached');
    setProofSource(null);
  });
});

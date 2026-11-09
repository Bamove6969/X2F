// @vitest-environment happy-dom
// Owner, 8 Nov 2026: the Terms are agreed once, at account opening (and again when they change),
// with the tick AND a signature. The pad's model, the pad (empty vs drawn, Clear, the typed
// fallback) and the screen's gating (I accept needs both), against a stubbed auth client.
import { createHash } from 'node:crypto';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TermsSignature } from '@x2f/auth-client';
import {
  MAX_POINTS, MAX_TYPED_NAME, SIGNATURE_MAX_BYTES, drawnSignature, keepPoint, scaleStrokes, signatureBytes, strokesToPath, typedSignature,
} from '../src/screens/setup/signature.js';
import { SignaturePad } from '../src/screens/setup/SignaturePad.js';
import { Terms } from '../src/screens/setup/Terms.js';
import { KEY_POINTS, PRIVACY_HEADING, TERMS, TERMS_DRAFT_NOTE, TERMS_TEXT_VERSION } from '../src/screens/setup/termsText.js';
import { fire, render } from './render.js';

const auth = vi.hoisted(() => ({
  getTerms: vi.fn(async () => ({ version: '' })),
  acceptTerms: vi.fn(async (_b: { version: string; signature: TermsSignature }) => undefined),
}));
vi.mock('../src/screens/auth/authApi.js', () => ({ authApi: auth }));
vi.mock('../src/session/useSession.js', () => ({ refreshSession: () => undefined }));

const PAD_W = 320;
const PAD_H = 132;

beforeEach(() => {
  auth.getTerms.mockImplementation(async () => ({ version: TERMS_TEXT_VERSION }));
  auth.acceptTerms.mockClear();
  // happy-dom lays nothing out: give the pad a size.
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(PAD_W);
  vi.spyOn(HTMLCanvasElement.prototype, 'clientHeight', 'get').mockReturnValue(PAD_H);
});
afterEach(() => vi.restoreAllMocks());

function pointerAt(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) {
  fire(el, new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, pointerType: 'pen', clientX: x, clientY: y }));
}

/** Draws one stroke through the points on the pad. */
function draw(pad: Element, pts: [number, number][]) {
  const [first, ...rest] = pts;
  pointerAt(pad, 'pointerdown', first![0], first![1]);
  for (const [x, y] of rest) pointerAt(pad, 'pointermove', x, y);
  const last = pts[pts.length - 1]!;
  pointerAt(pad, 'pointerup', last[0], last[1]);
}

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const click = (el: Element | null) => {
  if (el === null) throw new Error('no element');
  fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
};

const flush = () => act(async () => {
  await Promise.resolve();
});

describe('signature model', () => {
  it('turns strokes into a whole-pixel path inside the box; a tap is a dot', () => {
    expect(strokesToPath([[[10.4, 20.6], [30, 40]], [[5, 5]]], 320, 132)).toBe('M10 21L30 40M5 5L5 5');
    expect(strokesToPath([[[-3, 500], [400, -1]]], 320, 132)).toBe('M0 132L320 0');
    expect(drawnSignature([], 320, 132)).toBeNull();
    expect(drawnSignature([[[1, 2], [3, 4]]], 320.4, 131.6)).toEqual({ kind: 'drawn', width: 320, height: 132, path: 'M1 2L3 4' });
  });

  it('drops points too close to the last one', () => {
    expect(keepPoint([], [0, 0])).toBe(true);
    expect(keepPoint([[0, 0]], [1, 1])).toBe(false);
    expect(keepPoint([[0, 0]], [2, 0])).toBe(true);
  });

  it('a pad full of points stays under the API cap', () => {
    const stroke = Array.from({ length: MAX_POINTS }, (_, i) => [4000 + (i % 96), 4000 + (i % 96)] as const);
    const sig = drawnSignature([stroke], 4096, 4096)!;
    expect(signatureBytes(sig)).toBeLessThan(SIGNATURE_MAX_BYTES);
  });

  it('a typed name is trimmed and folded; empty, too long or control characters give none', () => {
    expect(typedSignature('  Mira   K ')).toEqual({ kind: 'typed', name: 'Mira K' });
    expect(typedSignature('   ')).toBeNull();
    expect(typedSignature('x'.repeat(MAX_TYPED_NAME + 1))).toBeNull();
    expect(typedSignature('a‮b')).toBeNull();
    expect(typedSignature('a\ud800b')).toBeNull();
    for (const c of ['\u061c', '\u200b', '\u200e', '\u200f', '\u2060', '\u2064', '\ufeff', '\u{e0001}', '\u{e007f}']) expect(typedSignature(`Mi${c}ra`), c).toBeNull();
    expect(typedSignature('\u200c')).toBeNull();
    expect(typedSignature(' \u200d\u200c ')).toBeNull();
    expect(typedSignature('می\u200cخواهم')).toEqual({ kind: 'typed', name: 'می\u200cخواهم' });
  });

  // Security review 2026-11-08, finding 7: the same list as the API's test.
  it('refuses every invisible character, alone as the whole name and inside one', () => {
    const invisible = [
      '\u00ad', '\u034f', '\u115f', '\u1160', '\u17b4', '\u180e', '\u2065', '\u2800', '\u3164', '\ufe0f', '\uffa0', '\ufff9', '\u{1bca0}', '\u{1d173}', '\u{e0100}',
    ];
    expect(invisible).toHaveLength(15);
    for (const c of invisible) {
      expect(typedSignature(c), `alone ${c.codePointAt(0)!.toString(16)}`).toBeNull();
      expect(typedSignature(`Mi${c}ra`), `inside ${c.codePointAt(0)!.toString(16)}`).toBeNull();
    }
    expect(typedSignature('José Núñez')).toEqual({ kind: 'typed', name: 'José Núñez' });
    expect(typedSignature('李小龙')).toEqual({ kind: 'typed', name: '李小龙' });
  });

  it('scales strokes when the pad changes size', () => {
    expect(scaleStrokes([[[10, 10], [20, 30]]], { width: 100, height: 50 }, { width: 200, height: 100 })).toEqual([[[20, 20], [40, 60]]]);
  });
});

describe('SignaturePad', () => {
  function mount() {
    const seen: (TermsSignature | null)[] = [];
    const { host } = render(<SignaturePad onChange={(s) => seen.push(s)} />);
    const pad = () => host.querySelector('[data-part="signature-pad"]')!;
    return { host, seen, pad, last: () => seen[seen.length - 1] };
  }

  it('is empty until something is drawn, and gives the drawn path after a stroke', () => {
    const { host, last, pad } = mount();
    expect(last()).toBeNull();
    expect(pad().getAttribute('data-empty')).toBe('true');
    expect(host.querySelector<HTMLButtonElement>('[data-part="signature-clear"]')!.disabled).toBe(true);
    draw(pad(), [[10, 10], [60, 60]]);
    draw(pad(), [[60, 10], [10, 60]]);
    expect(last()).toEqual({ kind: 'drawn', width: PAD_W, height: PAD_H, path: 'M10 10L60 60M60 10L10 60' });
    expect(pad().getAttribute('data-empty')).toBe('false');
  });

  it('a single tap counts as a mark', () => {
    const { last, pad } = mount();
    draw(pad(), [[30, 40]]);
    expect(last()).toEqual({ kind: 'drawn', width: PAD_W, height: PAD_H, path: 'M30 40L30 40' });
  });

  it('Clear empties it', () => {
    const { host, last, pad } = mount();
    draw(pad(), [[10, 10], [60, 60]]);
    click(host.querySelector('[data-part="signature-clear"]'));
    expect(last()).toBeNull();
    expect(pad().getAttribute('data-empty')).toBe('true');
  });

  it('a pointer that moves without pressing draws nothing', () => {
    const { last, pad } = mount();
    pointerAt(pad(), 'pointermove', 10, 10);
    pointerAt(pad(), 'pointermove', 50, 50);
    expect(last()).toBeNull();
  });

  it('Type your name to sign: the typed name is the signature; Draw instead goes back to the drawing', () => {
    const { host, last, pad } = mount();
    draw(pad(), [[10, 10], [60, 60]]);
    click(host.querySelector('[data-part="signature-type"]'));
    expect(last()).toBeNull();
    const input = host.querySelector<HTMLInputElement>('[data-part="signature-name"]')!;
    expect(host.querySelector(`label[for="${input.id}"]`)!.textContent).toBe('Type your name to sign');
    // Keyboard users land in the field at once.
    expect(document.activeElement).toBe(input);
    typeInto(input, '  Mira K ');
    expect(last()).toEqual({ kind: 'typed', name: 'Mira K' });
    typeInto(input, '   ');
    expect(last()).toBeNull();
    click(host.querySelector('[data-part="signature-draw"]'));
    expect(last()).toEqual({ kind: 'drawn', width: PAD_W, height: PAD_H, path: 'M10 10L60 60' });
  });

  // Security review 2026-11-08, finding 2: the browser must not offer the person's real name.
  it('does not autofill a name into the typed fallback', () => {
    const { host } = mount();
    click(host.querySelector('[data-part="signature-type"]'));
    expect(host.querySelector('[data-part="signature-name"]')!.getAttribute('autocomplete')).toBe('off');
  });

  it("shows design's baseline words (p11-15), not part of the drawing", () => {
    const { host } = mount();
    const line = host.querySelector('.x2f-sign__line')!;
    expect(line.textContent).toBe('Sign your name here with your finger or mouse. A scribble or an X is fine.');
    expect(line.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.x2f-sign__pad canvas')).not.toBeNull();
  });
});

// Security review 2026-11-08, finding 10: a signature binds to the version label, so the label has
// to move whenever the words do. Editing the Terms fails here until TERMS_TEXT_VERSION (and the
// server's X2F_TERMS_VERSION) moves too; then put the new version and hash in this pin.
describe('the Terms text is pinned to its version', () => {
  const PIN = { version: '2026-11-09', sha256: 'fa32ddddee4dd3fabb41fe562184ee93bcce15d4eae9a5070c30e5b03f86e2fc' };

  it('has not changed without a new version', () => {
    const text = JSON.stringify({ TERMS_DRAFT_NOTE, KEY_POINTS, PRIVACY_HEADING, TERMS });
    expect({ version: TERMS_TEXT_VERSION, sha256: createHash('sha256').update(text, 'utf8').digest('hex') }).toEqual(PIN);
  });
});

describe('the Terms screen: I accept needs the tick and a signature', () => {
  async function mount() {
    const { host } = render(
      <MemoryRouter initialEntries={['/terms?returnTo=%2Falerts']}>
        <Terms />
      </MemoryRouter>,
    );
    await flush();
    const accept = () => host.querySelector<HTMLButtonElement>('[data-part="terms-accept"]')!;
    const tick = host.querySelector<HTMLInputElement>('[data-part="terms-tick"]')!;
    const pad = () => host.querySelector('[data-part="signature-pad"]')!;
    return { host, accept, tick, pad };
  }

  it('stays disabled with only the tick, or only a signature', async () => {
    const { accept, tick, pad, host } = await mount();
    expect(tick.disabled).toBe(false); // happy-dom: the box shows everything, so it counts as read
    expect(accept().disabled).toBe(true);
    click(tick);
    expect(tick.checked).toBe(true);
    expect(accept().disabled).toBe(true);
    draw(pad(), [[10, 10], [60, 60]]);
    expect(accept().disabled).toBe(false);
    click(tick);
    expect(accept().disabled).toBe(true);
    click(tick);
    click(host.querySelector('[data-part="signature-clear"]'));
    expect(accept().disabled).toBe(true);
  });

  it('the tick box explains that a signature is needed', async () => {
    const { tick, host } = await mount();
    const ids = (tick.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toContain('terms-sign-help');
    expect(host.querySelector('#terms-sign-help')!.textContent).toContain('A scribble or an X is fine.');
  });

  it('accepting sends the version with the drawn signature', async () => {
    const { accept, tick, pad } = await mount();
    click(tick);
    draw(pad(), [[10, 10], [60, 60]]);
    click(accept());
    await flush();
    expect(auth.acceptTerms).toHaveBeenCalledWith({
      version: TERMS_TEXT_VERSION, signature: { kind: 'drawn', width: PAD_W, height: PAD_H, path: 'M10 10L60 60' },
    });
  });

  it('accepting with a typed name sends it as the signature', async () => {
    const { accept, tick, host } = await mount();
    click(tick);
    click(host.querySelector('[data-part="signature-type"]'));
    typeInto(host.querySelector<HTMLInputElement>('[data-part="signature-name"]')!, 'Mira K');
    expect(accept().disabled).toBe(false);
    click(accept());
    await flush();
    expect(auth.acceptTerms).toHaveBeenCalledWith({ version: TERMS_TEXT_VERSION, signature: { kind: 'typed', name: 'Mira K' } });
  });
});

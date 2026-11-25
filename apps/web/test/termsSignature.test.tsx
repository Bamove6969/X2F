// @vitest-environment happy-dom
// Owner, 8 Nov 2026: the Terms are agreed once, at account opening (and again when they change),
// with the tick AND a signature. The pad's model, the pad (empty vs drawn, Clear, the typed
// fallback) and the screen's gating (I accept needs both), against a stubbed auth client.
import { createHash } from 'node:crypto';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, type TermsSignature } from '@x2f/auth-client';
import {
  MAX_POINTS, MAX_TYPED_NAME, SIGNATURE_MAX_BYTES, drawnSignature, keepPoint, scaleStrokes, signatureBytes, strokesToPath, typedSignature,
} from '../src/screens/setup/signature.js';
import { SignaturePad } from '../src/screens/setup/SignaturePad.js';
import { INITIAL, SetupContext } from '../src/screens/setup/kit.js';
import { SetupTerms, Terms } from '../src/screens/setup/Terms.js';
import { KEY_POINTS, PRIVACY_HEADING, TERMS, TERMS_DRAFT_NOTE, TERMS_TEXT_VERSION } from '../src/screens/setup/termsText.js';
import { fire, render } from './render.js';

const auth = vi.hoisted(() => ({
  getTerms: vi.fn(async () => ({ version: '' })),
  acceptTerms: vi.fn(async (_b: { version: string; signature?: TermsSignature }) => undefined),
}));
vi.mock('../src/screens/auth/authApi.js', () => ({ authApi: auth }));
const who = vi.hoisted(() => ({ member: false, status: 'signed-in' as 'signed-in' | 'loading' | 'error', code: 'network', refresh: vi.fn() }));
vi.mock('../src/session/useSession.js', () => ({
  refreshSession: () => who.refresh(),
  useSession: () =>
    who.status === 'signed-in'
      ? { status: 'signed-in', me: { member: who.member ? { name: 'AK', roles: [] } : null } }
      : who.status === 'error'
        ? { status: 'error', code: who.code }
        : { status: 'loading' },
}));

const PAD_W = 320;
const PAD_H = 132;

beforeEach(() => {
  auth.getTerms.mockImplementation(async () => ({ version: TERMS_TEXT_VERSION }));
  auth.acceptTerms.mockClear();
  who.member = false;
  who.status = 'signed-in';
  who.code = 'network';
  who.refresh.mockClear();
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
  // 2026-11-12: the owner's 16 /setup comments applied (comms terms-draft-2026-11-12.md): new version.
  // 2026-11-14: the owner's demo notes of 13 Nov (setup-terms) applied: new version.
  // 2026-11-23: the owner's demo notes of 16-17 Nov (#93, #102-#107) applied: new version.
  // 2026-11-25: the owner's demo notes of 23 Nov (#114-#123) and 25 Nov (#177-#185) applied: new version.
  // 2026-11-25b: owner demo note #189 (section 7 his #184 paragraph, section 6 the proofs' metadata, the key points): new version.
  const PIN = { version: '2026-11-25b', sha256: 'db24a7f9bdcc8736e88aa160199e2f23435032f534b0f389635eaff484f3270b' };

  it('has not changed without a new version', () => {
    const text = JSON.stringify({ TERMS_DRAFT_NOTE, KEY_POINTS, PRIVACY_HEADING, TERMS });
    expect({ version: TERMS_TEXT_VERSION, sha256: createHash('sha256').update(text, 'utf8').digest('hex') }).toEqual(PIN);
  });
});

// Owner demo notes 13 Nov (setup-terms): the timer paragraph's advice is a bulleted list after it.
describe('the Terms text: bullets', () => {
  it('shows a paragraph’s bullets as a list right after it', async () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/terms?returnTo=%2Falerts']}>
        <Terms />
      </MemoryRouter>,
    );
    await flush();
    const lists = host.querySelectorAll('[data-part="terms-text"] ul.x2f-terms__bullets');
    expect(lists).toHaveLength(1);
    expect(lists[0]!.previousElementSibling?.textContent).toMatch(/^Each trade has timers,.*always make sure to:$/);
    expect([...lists[0]!.querySelectorAll('li')].map((li) => li.textContent)).toHaveLength(4);
    // Owner demo note #106 (17 Nov): his late-payment sentence in place of the 14 Nov bullet.
    expect(lists[0]!.lastElementChild?.textContent).toBe(
      'If for some reason you don’t pay until after your allotted time runs out, the seller triggers a cancellation that automatically refunds the XMR to the seller, and you can’t figure it out amicably between yourself and the other trader, then this is a scenario when you would call upon a moderator to help settle the dispute, whether that means seeing the XMR transferred to you or a refund of the payment you made. The outcome will always be fair. The trade screen always shows the time left.',
    );
  });
});

// Owner demo note #187 (25 Nov 2026): no scroll box of its own. Owner demo note #190 (25 Nov 2026):
// no read-to-the-end gate either; the tick is the only condition.
describe('the Terms screen: in the page, no gate, the log-in line last', () => {
  it('the tick is usable at once, with no scroll hint, even with the end of the Terms far off screen', async () => {
    const rect = (bottom: number) => ({ x: 0, y: 0, top: bottom - 20, left: 0, right: 0, width: 0, height: 20, bottom, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return rect(this.dataset.part === 'terms-end' ? 5000 : 760);
    });
    const { host } = render(
      <MemoryRouter initialEntries={['/terms?returnTo=%2Falerts']}>
        <Terms />
      </MemoryRouter>,
    );
    await flush();
    const region = host.querySelector<HTMLElement>('[data-part="terms-text"]')!;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.tabIndex).toBe(0);
    const tick = host.querySelector<HTMLInputElement>('[data-part="terms-tick"]')!;
    expect(tick.disabled).toBe(false);
    expect(host.querySelector('#terms-hint')).toBeNull();
    expect(host.textContent).not.toMatch(/Scroll to the end/i);
    expect(tick.getAttribute('aria-describedby')).toBeNull();
  });

  it('on SetupTerms: the tick box, then the button, then "Already have an account? Log in"', async () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/setup']}>
        <SetupContext.Provider value={{ state: INITIAL, update: () => undefined, returnTo: '/post', go: () => undefined, path: (s) => `/setup/${s}` }}>
          <SetupTerms />
        </SetupContext.Provider>
      </MemoryRouter>,
    );
    await flush();
    const tick = host.querySelector('[data-part="terms-tick"]')!;
    const accept = host.querySelector<HTMLButtonElement>('[data-part="terms-accept"]')!;
    const login = host.querySelector('[data-part="setup-login"]')!;
    expect(accept.textContent).toBe('Start creating my account');
    expect(accept.disabled).toBe(true);
    expect(tick.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(accept.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(login.closest('p')!.textContent).toBe('Already have an account? Log in');
    click(tick);
    expect(accept.disabled).toBe(false);
  });
});

// Owner demo note #187 (25 Nov 2026): a trader agrees with the tick alone (a clickwrap).
describe('the Terms screen for a trader: the tick alone, no signature', () => {
  async function mount() {
    const { host } = render(
      <MemoryRouter initialEntries={['/terms?returnTo=%2Falerts']}>
        <Terms />
      </MemoryRouter>,
    );
    await flush();
    const accept = () => host.querySelector<HTMLButtonElement>('[data-part="terms-accept"]')!;
    const tick = host.querySelector<HTMLInputElement>('[data-part="terms-tick"]')!;
    return { host, accept, tick };
  }

  it('has no pad, no typed name and no sign help; the tick line is the owner\'s exact words', async () => {
    const { host, tick } = await mount();
    expect(host.querySelector('[data-part="signature-pad"]')).toBeNull();
    expect(host.querySelector('[data-part="signature-type"]')).toBeNull();
    expect(host.querySelector('#terms-sign-help')).toBeNull();
    expect(host.textContent).not.toMatch(/sign your name|sign in the white box|scribble|Type your name/i);
    const line = host.querySelector('#' + tick.getAttribute('aria-labelledby'))!;
    expect(line.textContent!.replace(/\s+/g, ' ').trim()).toBe('I have read and agree to the Terms of Service and Privacy Policy');
    expect(tick.getAttribute('aria-describedby') ?? '').not.toContain('terms-sign-help');
  });

  it('the tick enables accepting, and accepting sends the version with no signature', async () => {
    const { accept, tick } = await mount();
    expect(tick.disabled).toBe(false); // no read-to-the-end gate (owner demo note #190)
    expect(accept().disabled).toBe(true);
    click(tick);
    expect(accept().disabled).toBe(false);
    click(tick);
    expect(accept().disabled).toBe(true);
    click(tick);
    click(accept());
    await flush();
    expect(auth.acceptTerms).toHaveBeenCalledWith({ version: TERMS_TEXT_VERSION });
    expect(auth.acceptTerms.mock.calls[0]![0]).not.toHaveProperty('signature');
  });
});

// Review of owner demo note #187 (25 Nov 2026), fixes M1, M2, L4, L6 and test 9.
describe('the Terms screen: review fixes', () => {
  const mount = async () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/terms?returnTo=%2Falerts']}>
        <Terms />
      </MemoryRouter>,
    );
    await flush();
    return {
      host,
      tick: host.querySelector<HTMLInputElement>('[data-part="terms-tick"]')!,
      accept: () => host.querySelector<HTMLButtonElement>('[data-part="terms-accept"]')!,
    };
  };

  it('while the session loads, the button waits even when ticked, and nothing is posted', async () => {
    who.status = 'loading';
    const { tick, accept } = await mount();
    click(tick);
    expect(tick.checked).toBe(true);
    expect(accept().disabled).toBe(true);
    click(accept());
    await flush();
    expect(auth.acceptTerms).not.toHaveBeenCalled();
  });

  it('a session that could not be read says so with a retry, and nobody can post (a member must not post unsigned)', async () => {
    who.status = 'error';
    const { host, tick, accept } = await mount();
    const notice = host.querySelector('[data-part="terms-session-error"]')!;
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.closest('.x2f-start__foot')).not.toBeNull();
    click(tick);
    expect(accept().disabled).toBe(true);
    click(notice.querySelector('button'));
    expect(who.refresh).toHaveBeenCalledTimes(1);
    expect(auth.acceptTerms).not.toHaveBeenCalled();
  });

  it('a terms-required session error is no dead end: signed in on old Terms, the tick alone posts', async () => {
    who.status = 'error';
    who.code = 'terms-required';
    const { host, tick, accept } = await mount();
    expect(host.querySelector('[data-part="terms-session-error"]')).toBeNull();
    click(tick);
    expect(accept().disabled).toBe(false);
    click(accept());
    await flush();
    expect(auth.acceptTerms).toHaveBeenCalledWith({ version: TERMS_TEXT_VERSION });
  });

  it('a member the page could not tell apart: signature-required from the API brings up the pad, and the signed retry posts', async () => {
    who.status = 'error';
    who.code = 'terms-required';
    auth.acceptTerms.mockImplementationOnce(async () => {
      throw new AuthApiError(400, 'signature-required');
    });
    const { host, tick, accept } = await mount();
    expect(host.querySelector('[data-part="signature-pad"]')).toBeNull();
    click(tick);
    click(accept());
    await flush();
    await flush();
    expect(host.querySelector('[data-part="signature-pad"]')).not.toBeNull();
    expect(host.querySelector('.x2f-start__foot [role="alert"]')!.textContent).toBe('Your login signs the Terms too. Sign in the white box, then accept.');
    expect(accept().disabled).toBe(true);
    draw(host.querySelector('[data-part="signature-pad"]')!, [[10, 10], [60, 60]]);
    expect(accept().disabled).toBe(false);
    click(accept());
    await flush();
    expect(auth.acceptTerms).toHaveBeenLastCalledWith({
      version: TERMS_TEXT_VERSION, signature: { kind: 'drawn', width: PAD_W, height: PAD_H, path: 'M10 10L60 60' },
    });
  });

  it('the notices sit in the bottom bar, over the button, not below the in-page Terms', async () => {
    auth.getTerms.mockImplementation(async () => ({ version: '2099-01-01' }));
    const { host, accept } = await mount();
    const stale = host.querySelector('[data-part="terms-stale"]')!;
    expect(stale.closest('.x2f-start__foot')).not.toBeNull();
    expect(stale.compareDocumentPosition(accept()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a tap anywhere on the tick row ticks the box, but the two buttons never do', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    const { host, tick } = await mount();
    const row = host.querySelector<HTMLElement>('[data-part="terms-agree"]')!;
    expect(row.classList.contains('x2f-check--tap')).toBe(true);
    click(row);
    expect(tick.checked).toBe(true);
    click(row.querySelector('#terms-tick-line')!);
    expect(tick.checked).toBe(false);
    click(host.querySelector('[data-part="terms-show-privacy"]'));
    click(host.querySelector('[data-part="terms-show-tos"]'));
    expect(tick.checked).toBe(false);
    click(tick);
    expect(tick.checked).toBe(true);
    // The accessible name is still the whole line.
    expect(tick.getAttribute('aria-labelledby')).toBe('terms-tick-line');
  });

  it('the sections inside the full Terms are h3, under the cards\' h2', async () => {
    const { host } = await mount();
    const region = host.querySelector('[data-part="terms-text"]')!;
    expect(region.querySelectorAll('h2')).toHaveLength(0);
    expect(region.querySelectorAll('h3.x2f-terms__heading').length).toBe(TERMS.length);
  });
});

// Owner demo note #190 (25 Nov 2026): the two cards' headings.
describe('the Terms screen: the cards\' headings', () => {
  it('reads "Key Highlights (TL;DR)" over the six points, and "Full Terms of Service (Version …)" once the version loads', async () => {
    let answer: (v: { version: string }) => void = () => undefined;
    auth.getTerms.mockImplementation(() => new Promise((r) => (answer = r)));
    const { host } = render(
      <MemoryRouter initialEntries={['/terms?returnTo=%2Falerts']}>
        <Terms />
      </MemoryRouter>,
    );
    await flush();
    expect(host.querySelector('#terms-glance-heading')!.textContent).toBe('Key Highlights (TL;DR)');
    expect(host.querySelectorAll('[data-part="terms-glance"] li')).toHaveLength(KEY_POINTS.length);
    const full = () => host.querySelector('[data-part="terms-full-heading"]')!.textContent;
    expect(full()).toBe('Full Terms of Service');
    await act(async () => answer({ version: TERMS_TEXT_VERSION }));
    expect(full()).toBe(`Full Terms of Service (Version ${TERMS_TEXT_VERSION})`);
    expect(TERMS_TEXT_VERSION).toBe('2026-11-25b');
  });
});

// Owner demo note #189 (25 Nov 2026): "Privacy Policy" opens the privacy section in place.
describe('the Terms screen: the Privacy Policy and Terms of Service buttons', () => {
  it('show their section in this page, focus it, never navigate and never tick the box', async () => {
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      scrolled.push(this.id || this.textContent || '');
    });
    const { host } = render(
      <MemoryRouter initialEntries={['/setup']}>
        <Terms />
      </MemoryRouter>,
    );
    await flush();
    const tick = host.querySelector<HTMLInputElement>('[data-part="terms-tick"]')!;
    const privacy = host.querySelector<HTMLButtonElement>('[data-part="terms-show-privacy"]')!;
    expect(privacy.tagName).toBe('BUTTON');
    expect(privacy.type).toBe('button');
    expect(privacy.closest('label')).toBeNull();
    expect(host.querySelector('a[href*="privacy" i]')).toBeNull();
    const before = window.location.href;
    click(privacy);
    expect(tick.checked).toBe(false);
    expect(scrolled).toEqual(['terms-privacy']);
    const heading = host.querySelector('#terms-privacy')!;
    expect(heading.textContent).toBe(PRIVACY_HEADING);
    expect(document.activeElement).toBe(heading);
    expect(privacy.getAttribute('aria-controls')).toBe('terms-privacy');
    click(host.querySelector('[data-part="terms-show-tos"]'));
    expect(tick.checked).toBe(false);
    expect(scrolled).toEqual(['terms-privacy', 'terms-full-heading']);
    expect(window.location.href).toBe(before);
    // The words are the box's labels: tapping them ticks it.
    click(host.querySelector('label[for="terms-tick"]'));
    expect(tick.checked).toBe(true);
  });
});

// A team member's session still signs on /terms (owner 9 Nov 2026, p11-14; the API requires it).
describe('the Terms screen for a team member: I accept needs the tick and a signature', () => {
  beforeEach(() => {
    who.member = true;
  });

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

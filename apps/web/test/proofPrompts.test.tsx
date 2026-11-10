// @vitest-environment happy-dom
// Owner items 63 and 64 (2026-11-02 04:08, built on the kit 2026-11-03, Q21): pop-ups to the person
// POSTING the proof when the smart check finds the screenshot is not current or finds no amount;
// owner 2026-11-02 08:17: a warning when the uploader's own blur covers the amount or the memo
// (posting still allowed); item 65: the "X2F's own screen as fake proof" disclaimer. The upload
// screen itself is Plan 5 Task 15's; these are its units.
import { type OcrWord, type ProofCheck, type ProofExpected, proofDate } from '@x2f/proof';
import { describe, expect, it, vi } from 'vitest';
import { POSTER_BLOCKED_WHEN_OUT_OF_RANGE, hiddenByUploader, uploadPrompts, uploaderPopup } from '../src/proof/uploaderChecks.js';
import {
  PROOF_AMOUNT_HIDDEN,
  PROOF_EXPLANATION_REQUIRED,
  PROOF_FAKE_DISCLAIMER,
  PROOF_MEMO_HIDDEN,
  PROOF_NO_AMOUNT,
  PROOF_NOT_CURRENT,
  ProofFakeDisclaimer,
  ProofHiddenByYou,
  ProofNoAmount,
  ProofNotCurrent,
} from '../src/screens/proof/ProofPrompts.js';
import { fire, render } from './render.js';
import { act } from 'react';

const ok: ProofCheck = { readable: true, amount: { status: 'match', seen: 41250n }, reference: 'match', date: 'in-range', name: 'not-found' };

describe('uploaderPopup: which pop-up the proof poster sees', () => {
  it('none for a good screenshot, a mismatched amount (item 62: the seller decides) or an unreadable one', () => {
    expect(uploaderPopup(ok)).toBeNull();
    expect(uploaderPopup({ ...ok, amount: { status: 'mismatch', seen: 40000n } })).toBeNull();
    expect(uploaderPopup({ ...ok, date: 'not-found' })).toBeNull();
    // Unreadable: the editor's own "couldn't check this image" line covers it (Task 15).
    expect(uploaderPopup({ readable: false, amount: { status: 'not-found', seen: null }, reference: 'not-found', date: 'not-found', name: 'not-found' })).toBeNull();
  });

  it('item 63 blocks whenever the date is out of range, even on an unreadable screenshot (lead default pending owner p11-143)', () => {
    expect(POSTER_BLOCKED_WHEN_OUT_OF_RANGE).toBe(true);
    expect(uploaderPopup({ readable: false, amount: { status: 'not-found', seen: null }, reference: 'not-found', date: 'out-of-range', name: 'not-found' })).toBe('not-current');
  });

  it('item 63: a date outside the trade -> not-current; it wins over a missing amount', () => {
    expect(uploaderPopup({ ...ok, date: 'out-of-range' })).toBe('not-current');
    expect(uploaderPopup({ ...ok, date: 'out-of-range', amount: { status: 'not-found', seen: null } })).toBe('not-current');
  });

  it('item 64: no amount found -> no-amount', () => {
    expect(uploaderPopup({ ...ok, amount: { status: 'not-found', seen: null } })).toBe('no-amount');
  });
});

describe('hiddenByUploader: the uploader\'s own blur over the amount or the memo', () => {
  const amount = [{ x0: 100, y0: 40, x1: 170, y1: 56 }];
  const memo = [{ x0: 50, y0: 20, x1: 240, y1: 36 }];
  it('an overlap of any area counts; touching edges do not', () => {
    expect(hiddenByUploader([], amount, memo)).toEqual({ amount: false, memo: false });
    expect(hiddenByUploader([{ x0: 160, y0: 50, x1: 300, y1: 60 }], amount, memo)).toEqual({ amount: true, memo: false });
    expect(hiddenByUploader([{ x0: 0, y0: 0, x1: 50, y1: 20 }], amount, memo)).toEqual({ amount: false, memo: false });
    expect(hiddenByUploader([{ x0: 0, y0: 0, x1: 999, y1: 999 }], amount, memo)).toEqual({ amount: true, memo: true });
  });
});

describe('uploadPrompts: the check the uploader\'s app runs on its own screenshot before sending', () => {
  // One word per line; 10 px a character, 20 px a line (as @x2f/proof's test OCR).
  const words = (...lines: string[]): OcrWord[] =>
    lines.flatMap((text, line) => {
      let col = 0;
      return text.split(' ').map((t) => {
        const w = { text: t, x0: col * 10, y0: line * 20, x1: (col + t.length) * 10, y1: line * 20 + 16, line, conf: 90 };
        col += t.length + 1;
        return w;
      });
    });
  const expected: ProofExpected = {
    fiatCents: 41250n,
    currency: 'USD',
    exponent: 2,
    tradeCode: 'K7M2-9QXA-4FTR-8WPN',
    earliest: new Date('2026-10-15T12:00:00Z'),
    latest: new Date('2026-10-16T12:00:00Z'),
  };

  it('a current screenshot with the amount: no pop-up, nothing hidden', () => {
    const w = words('Sent Oct 16, 2026', 'Note K7M2-9QXA-4FTR-8WPN', 'Amount $412.50');
    expect(uploadPrompts(w, expected, [], null)).toEqual({ popup: null, date: 'in-range', hidden: { amount: false, memo: false } });
  });

  it('an old screenshot -> not-current; no amount -> no-amount', () => {
    expect(uploadPrompts(words('Sent Mar 2, 2025', 'Note K7M2-9QXA-4FTR-8WPN', 'Amount $412.50'), expected, [], null).popup).toBe('not-current');
    expect(uploadPrompts(words('Sent Oct 16, 2026', 'Note K7M2-9QXA-4FTR-8WPN', 'Thank you'), expected, [], null).popup).toBe('no-amount');
  });

  it('the uploader blurred the amount and the memo: warnings, and still no no-amount pop-up (the check reads the original)', () => {
    const w = words('Sent Oct 16, 2026', 'Note K7M2-9QXA-4FTR-8WPN', 'Amount $412.50');
    expect(uploadPrompts(w, expected, [{ x0: 0, y0: 20, x1: 400, y1: 60 }], null)).toEqual({ popup: null, date: 'in-range', hidden: { amount: true, memo: true } });
  });

  // Review 2026-11-10 finding 3: one date verdict for the poster, the photo's own time included.
  it('takes the photo\'s time and agrees with proofDate: not-current exactly when the date is out of range', () => {
    const shots = [
      words('Sent Oct 16, 2026', 'Note K7M2-9QXA-4FTR-8WPN', 'Amount $412.50'),
      words('Payment', 'Note K7M2-9QXA-4FTR-8WPN', 'Amount $412.50'),
      words('Sent Mar 2, 2025', 'Note K7M2-9QXA-4FTR-8WPN', 'Amount $412.50'),
      words('Sent Oct 16, 2026', 'Note K7M2-9QXA-4FTR-8WPN', 'Thank you'),
      words('Sent Oct 16, 2026', 'Note K7M2-9QXA-4FTR-8WPN', 'Amount $412.50').map((x) => ({ ...x, conf: 10 })),
    ];
    const photos = [null, new Date('2026-10-16T10:00:00Z'), new Date('2026-09-01T10:00:00Z')];
    for (const [i, w] of shots.entries()) {
      for (const takenAt of photos) {
        const p = uploadPrompts(w, expected, [], takenAt);
        const d = proofDate(w, takenAt, expected);
        expect(p.date, `${i} ${String(takenAt)}`).toBe(d);
        expect(p.popup === 'not-current', `${i} ${String(takenAt)}`).toBe(d === 'out-of-range');
      }
    }
    // An old receipt re-shot today is still not current (lead default pending owner p11-140).
    expect(uploadPrompts(shots[2]!, expected, [], new Date('2026-10-16T10:00:00Z')).popup).toBe('not-current');
    // No date on the screenshot: the photo's time decides.
    expect(uploadPrompts(shots[1]!, expected, [], new Date('2026-09-01T10:00:00Z')).popup).toBe('not-current');
    expect(uploadPrompts(shots[1]!, expected, [], null).date).toBe('not-found');
  });
});

describe('the pop-ups (kit Sheet; DESIGNER-REVIEW)', () => {
  it('item 63: the owner\'s sentence, one button that sends the person back to redo the proof', () => {
    const onRedo = vi.fn();
    render(<ProofNotCurrent open onRedo={onRedo} />);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(PROOF_NOT_CURRENT).toBe('The screenshot submitted is not current. Please redo proof and resubmit.');
    expect(dialog.querySelector('[data-part="proof-not-current"]')?.textContent).toBe(PROOF_NOT_CURRENT);
    expect(dialog.getAttribute('aria-describedby')).toBe(dialog.querySelector('[data-part="proof-not-current"]')!.id);
    const buttons = [...dialog.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Redo proof']);
    fire(buttons[0]!, new MouseEvent('click', { bubbles: true }));
    expect(onRedo).toHaveBeenCalledTimes(1);
    fire(document.querySelector('[data-part="backdrop"]')!, new MouseEvent('click', { bubbles: true }));
    expect(onRedo).toHaveBeenCalledTimes(2);
  });

  it('item 64: the owner\'s sentence, an optional comment box below it, Send proof always (lead default pending owner p11-141)', () => {
    const onSend = vi.fn();
    const onChooseAnother = vi.fn();
    const onClose = vi.fn();
    render(<ProofNoAmount open onSend={onSend} onChooseAnother={onChooseAnother} onClose={onClose} />);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(PROOF_NO_AMOUNT).toBe(
      'Our automated system was unable to detect the amount sent in your screenshot. Please use the feedback tool below and leave an explanation.',
    );
    expect(dialog.querySelector('[data-part="proof-no-amount"]')?.textContent).toBe(PROOF_NO_AMOUNT);
    const box = dialog.querySelector('textarea')!;
    expect(box.labels?.[0]?.textContent).toBe('Your explanation');
    expect(box.maxLength).toBe(500);
    const send = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Send proof')!;
    // Owner Q43 ("the buyer can say yes and post it anyways"): the explanation is optional.
    expect(PROOF_EXPLANATION_REQUIRED).toBe(false);
    expect(send.disabled).toBe(false);
    expect(box.required).toBe(false);
    fire(send, new MouseEvent('click', { bubbles: true }));
    expect(onSend).toHaveBeenLastCalledWith('');
    // A blank comment is sent as no explanation.
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(box, '   ');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(send.disabled).toBe(false);
    fire(send, new MouseEvent('click', { bubbles: true }));
    expect(onSend).toHaveBeenLastCalledWith('');
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(box, '  Paid in two parts, $400 and $12.50 ');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(send.disabled).toBe(false);
    fire(send, new MouseEvent('click', { bubbles: true }));
    expect(onSend).toHaveBeenCalledWith('Paid in two parts, $400 and $12.50');
    fire([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Choose another screenshot')!, new MouseEvent('click', { bubbles: true }));
    expect(onChooseAnother).toHaveBeenCalledTimes(1);
    expect([...dialog.querySelectorAll('[data-primary]')].map((b) => b.textContent)).toEqual(['Send proof']);
    fire(document.querySelector('[data-part="backdrop"]')!, new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(3);
  });
});

describe('the uploader\'s own-blur warning (owner 08:17) and the item-65 disclaimer', () => {
  it('shows the owner\'s amount line, the memo line, both, or nothing', () => {
    expect(PROOF_AMOUNT_HIDDEN).toBe('The amount is hidden, so the seller may not be able to check your payment.');
    const r = render(<ProofHiddenByYou hidden={{ amount: false, memo: false }} />);
    expect(r.host.textContent).toBe('');
    r.rerender(<ProofHiddenByYou hidden={{ amount: true, memo: false }} />);
    expect(r.host.querySelector('[data-part="proof-hidden-by-you"]')?.textContent).toBe(PROOF_AMOUNT_HIDDEN);
    expect(r.host.querySelector('[role="status"]')).not.toBeNull();
    r.rerender(<ProofHiddenByYou hidden={{ amount: false, memo: true }} />);
    expect(r.host.textContent).toBe(PROOF_MEMO_HIDDEN);
    r.rerender(<ProofHiddenByYou hidden={{ amount: true, memo: true }} />);
    expect(r.host.textContent).toBe(`${PROOF_AMOUNT_HIDDEN} ${PROOF_MEMO_HIDDEN}`);
    // A warning, not a block: nothing here to press.
    expect(r.host.querySelector('button')).toBeNull();
  });

  it('item 65: the disclaimer for the seller\'s proof card', () => {
    const r = render(<ProofFakeDisclaimer />);
    expect(r.host.querySelector('[data-part="proof-fake-disclaimer"]')?.textContent).toBe(PROOF_FAKE_DISCLAIMER);
    expect(PROOF_FAKE_DISCLAIMER).toMatch(/X2F/);
  });
});

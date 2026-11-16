// @vitest-environment happy-dom
// P-012 (owner Q47) and P-013 (owner p9-8): after a proof is posted, BOTH parties are asked (on the
// schedule the API keeps) whether the privacy tool blurred it correctly. One tap for Yes; No opens an
// optional comment box ("Please help us improve") that goes to X2F's feedback readers.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { answerBlurCheck, pendingBlurChecks, proofPosted } from '../src/api/blurCheck.js';
import { BLUR_CHECK_COMMENT_LABEL, BLUR_CHECK_QUESTION, BLUR_CHECK_THANKS, BlurCheck } from '../src/screens/proof/BlurCheck.js';
import { fire, render } from './render.js';

const click = (b: Element) => fire(b, new MouseEvent('click', { bubbles: true }));
const type = (box: HTMLTextAreaElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
const buttons = (host: HTMLElement) => [...host.querySelectorAll('button')];

describe('BlurCheck', () => {
  it('asks the question; Yes answers at once with no comment', async () => {
    const onAnswer = vi.fn(async () => {});
    const { host } = render(<BlurCheck onAnswer={onAnswer} />);
    expect(host.querySelector('[data-part="blur-check-question"]')?.textContent).toBe(BLUR_CHECK_QUESTION);
    expect(buttons(host).map((b) => b.textContent)).toEqual(['Yes', 'No']);
    await act(async () => click(buttons(host)[0]!));
    expect(onAnswer).toHaveBeenCalledWith({ correct: true });
    expect(host.textContent).toContain(BLUR_CHECK_THANKS);
  });

  it('No opens an optional comment box; Send hands over the trimmed comment, or none', async () => {
    const onAnswer = vi.fn(async () => {});
    const { host } = render(<BlurCheck onAnswer={onAnswer} />);
    click(buttons(host)[1]!);
    expect(onAnswer).not.toHaveBeenCalled();
    const box = host.querySelector('textarea')!;
    expect(box.labels?.[0]?.textContent).toBe(BLUR_CHECK_COMMENT_LABEL);
    expect(box.maxLength).toBe(500);
    type(box, '  The account number was readable. ');
    await act(async () => click(buttons(host).find((b) => b.textContent === 'Send')!));
    expect(onAnswer).toHaveBeenCalledWith({ correct: false, comment: 'The account number was readable.' });
    const again = render(<BlurCheck onAnswer={onAnswer} />);
    click(buttons(again.host)[1]!);
    await act(async () => click(buttons(again.host).find((b) => b.textContent === 'Send')!));
    expect(onAnswer).toHaveBeenLastCalledWith({ correct: false });
  });

  it('the copy (COPY-UNSIGNED, design words it)', () => {
    expect(BLUR_CHECK_QUESTION).toBe('Did our privacy tool hide the right details on this proof?');
    expect(BLUR_CHECK_COMMENT_LABEL).toBe('Please help us improve: what was wrong?');
  });
});

describe('the API calls', () => {
  it('posts and reads the routes the API serves', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
      const json = url.endsWith('/blur-check') ? { ask: true } : url.endsWith('/blur-checks') ? { checks: [{ proofId: 'P', role: 'receiver' }] } : null;
      return new Response(json === null ? null : JSON.stringify(json), { status: json === null ? 204 : 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await proofPosted('K7M2-9QXA-4FTR-8WPN', 'P', 'both')).toEqual({ ask: true });
      expect(await pendingBlurChecks('K7M2-9QXA-4FTR-8WPN')).toEqual([{ proofId: 'P', role: 'receiver' }]);
      await answerBlurCheck('K7M2-9QXA-4FTR-8WPN', 'P', { correct: false, comment: 'x' });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls.map((c) => [c.method, c.url.replace(/^.*\/v1\//, '/v1/'), c.body])).toEqual([
      ['POST', '/v1/trades/K7M2-9QXA-4FTR-8WPN/proofs/P/blur-check', { blur: 'both' }],
      ['GET', '/v1/trades/K7M2-9QXA-4FTR-8WPN/blur-checks', undefined],
      ['POST', '/v1/trades/K7M2-9QXA-4FTR-8WPN/blur-checks/P', { correct: false, comment: 'x' }],
    ]);
  });
});

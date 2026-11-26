// @vitest-environment happy-dom
// Owner demo note #28 (12 Nov 2026): Settings > Security speaks of the recovery code in the
// singular. Against a stubbed API that answers the way apps/api does today.
//
// What the API really sends (apps/api/src/auth/methods.ts:254): the recovery code row of
// GET /v1/account/methods has label `${unused} left`, e.g. "1 left". Methods.tsx:135 shows
// `m.label || LABELS[m.type]`, so the row reads "1 left" and the web `LABELS` entry ("Recovery code")
// is only a fallback for an empty label, which the API never sends. The API's own plural strings
// (methods.ts:211 "Recovery codes", used in the method-removed alert, and
// packages/accounts confirmAction.ts:100 "make new recovery codes") belong to the lead and stay
// plural until they change there; this branch does not touch apps/api or packages/accounts.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Methods } from '../src/screens/settings/Methods.js';
import { RecoveryCodes } from '../src/screens/settings/RecoveryCodes.js';
import { fire, render } from './render.js';

/** The server's one code (64 symbols). */
const CODE = `${'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-'.repeat(2).slice(0, 75)}0000`;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/v1/account/methods') {
      // The shape listMethods() returns for an account with one unused recovery code.
      return json(200, [{ type: 'recovery-codes', id: 'recovery-codes', label: '1 left', createdAt: null, lastUsedAt: null }]);
    }
    if (url === '/v1/account/recovery-codes') return json(200, { codes: [CODE] });
    return json(500, { error: 'internal' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

const byPart = (host: ParentNode, part: string) => host.querySelector<HTMLElement>(`[data-part="${part}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

describe('Security settings speaks of the recovery code in the singular (owner, 12 Nov 2026 note #28)', () => {
  it('the method list shows the label the API sends, and the add button is singular', async () => {
    const { host } = render(<Methods prove={async () => 'tok'} />);
    await flush();
    // The row text comes from the API ("1 left"), not from the web LABELS entry.
    expect(host.querySelector('[data-method="recovery-codes"] .x2f-list__label')?.textContent).toBe('1 left');
    expect(host.querySelector('[data-add="recovery-codes"]')?.textContent).toBe('Create recovery code');
  });

  it('making a new code speaks of one code', async () => {
    const { host } = render(<RecoveryCodes prove={async () => 'tok'} onDone={() => undefined} />);
    expect(byPart(host, 'recovery-make')?.textContent).toBe('Show my recovery code');
    click(byPart(host, 'recovery-make'));
    await flush();
    expect(host.querySelector('.x2f-note')?.textContent).toBe('Save this now. It works once, and you will not see it again.');
    expect(byPart(host, 'recovery-done')?.textContent).toBe('I have saved it');
  });
});

// @vitest-environment happy-dom
// Plan 4 Task 21 bug 2: after a refund the buyer's dispute puts the trade back in `disputed`, and a
// `seller-sends-xmr` ruling asks the seller to send the XMR and prove it. The seller opens
// /trade/:code/dispute (the ruling's link, the e2e row's page), which showed the ruling with no
// tx-proof form: only the trade room's DisputeSlot passed the escrow's attested `restitution`. The
// route now reads the same restitution from the escrow worker (subscribe only, never a start) and
// posts the proof; still no form without the attested terms, or when their amount is not the trade's.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EscrowStatus } from '../src/escrow/runtime.js';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { DisputeScreen } from '../src/screens/dispute/DisputeScreen.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

// Review m5, G18: the payTo DisputeScreen hands DisputeRuling, seen directly (DisputeRuling checks the
// amount again itself, so only this shows the route's own check).
const handed = vi.hoisted(() => ({ payTo: [] as unknown[] }));
vi.mock('../src/screens/dispute/DisputeRuling.js', async (orig) => {
  const real = await orig<typeof import('../src/screens/dispute/DisputeRuling.js')>();
  return {
    ...real,
    DisputeRuling: (p: Parameters<typeof real.DisputeRuling>[0]) => {
      handed.payTo.push(p.payTo ?? null);
      return real.DisputeRuling(p);
    },
  };
});

const MIN = 60_000;
const at = (ms: number) => new Date(Date.parse(SERVER_NOW) + ms).toISOString();
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const view = sellerView({ state: 'disputed', dispute: { by: 'buyer', at: at(-60 * MIN) }, settling: 'auto-refund' });
const ruling = {
  round: 1,
  outcome: 'seller-sends-xmr',
  reason: 'The buyer showed the payment; the seller got the refund and the money.',
  evidence: ['The trade chat'],
  moderatorName: 'sarah.v',
  ruledAt: at(-30 * MIN),
  appealUntil: at(47 * 60 * MIN),
  destination: null,
};
const disputeBody = {
  openedBy: 'buyer', reason: 'paid', openedAt: at(-60 * MIN), afterRefund: true, dueAt: null, status: 'ruled', moderator: { name: 'sarah.v', joinedAt: at(-50 * MIN) },
  ruling, appeal: null, serverNow: SERVER_NOW, complyBy: at(23 * 60 * MIN),
};

let fetchMock: ReturnType<typeof vi.fn>;
let started: string[];
let subscribed: string[];
let status: Partial<EscrowStatus> | null;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/payment-proof')) return jsonResponse({ status: 'accepted', confirmations: 10 });
    if (u.endsWith('/dispute')) return jsonResponse(disputeBody);
    if (u.endsWith(`/v1/trades/${view.code}`)) return jsonResponse(view);
    return jsonResponse({ error: 'not-found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  started = [];
  subscribed = [];
  status = null;
  const client: EscrowClient = {
    start: (code) => void started.push(code),
    act: async () => undefined,
    retry: () => undefined,
    subscribe: (code, cb) => {
      subscribed.push(code);
      if (status) cb(status as EscrowStatus);
      return () => undefined;
    },
  };
  setEscrowClient(client);
});
afterEach(() => {
  setEscrowClient(null);
  vi.unstubAllGlobals();
});

async function screen(): Promise<HTMLElement> {
  const { host } = render(
    <MemoryRouter initialEntries={[`/trade/${view.code}/dispute`]}>
      <Routes>
        <Route path="/trade/:code/dispute" element={<DisputeScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  return host;
}

describe('/trade/:code/dispute: the seller of an after-refund seller-sends-xmr ruling proves the payment (Task 21 bug 2)', () => {
  it('the form shows the attested address and amount from the escrow worker and posts the proof; the route never starts the escrow', async () => {
    status = { restitution: { address: '4AttestedBuyerAddressXyz', amountAtomic: BigInt(view.amountAtomic) } };
    const host = await screen();
    const form = host.querySelector('[aria-label="Transfer proof"]');
    expect(form, host.textContent ?? '').not.toBeNull();
    expect(form!.querySelector('[data-part="pay-address"]')!.textContent).toBe('4AttestedBuyerAddressXyz');
    expect(subscribed).toContain(view.code);
    expect(started).toEqual([]);
    const [hash, key] = [...form!.querySelectorAll<HTMLInputElement>('input')];
    for (const [el, v] of [[hash!, 'c'.repeat(64)], [key!, 'd'.repeat(64)]] as const) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await act(async () => {
      form!.querySelector<HTMLButtonElement>('button')!.click();
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    const post = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/payment-proof'))!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ txHash: 'c'.repeat(64), txKey: 'd'.repeat(64) });
    expect(host.querySelector('[data-part="tx-proof-sent"]')).not.toBeNull();
  });

  it('no form without attested terms on this device, nor when their amount is not the trade amount', async () => {
    for (const s of [null, { restitution: null }, { restitution: { address: '4AttestedBuyerAddressXyz', amountAtomic: BigInt(view.amountAtomic) + 1n } }]) {
      status = s;
      const host = await screen();
      expect(host.textContent).toContain('You must send');
      expect(host.querySelector('[aria-label="Transfer proof"]')).toBeNull();
    }
  });

  it('G18: the route hands DisputeRuling a payTo only when the attested amount is the trade amount', async () => {
    const attested = { address: '4AttestedBuyerAddressXyz', amountAtomic: BigInt(view.amountAtomic) };
    for (const [amountAtomic, want] of [[attested.amountAtomic + 1n, null], [attested.amountAtomic - 1n, null], [attested.amountAtomic, attested]] as const) {
      handed.payTo = [];
      status = { restitution: { ...attested, amountAtomic } };
      await screen();
      expect(handed.payTo.length).toBeGreaterThan(0);
      expect(handed.payTo.at(-1)).toEqual(want);
    }
  });
});

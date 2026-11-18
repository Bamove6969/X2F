// @vitest-environment happy-dom
// Plan 7 Task 3: the self-destruct date in the trade room (TradeView.deleteAt, the server's), and
// this device's own copies of the trade going once that date has passed by the SERVER's clock, also
// when the app was closed at that moment (runConfirmedLocalPurge at start-up).
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTradeView, TradeShapeError } from '../src/api/trade.js';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { TradeRoom } from '../src/screens/trade/TradeRoom.js';
import { sellerView } from '../e2e/refundViews.js';
import {
  DELETE_AT_KEY,
  localPurgeDue,
  purgeTradeLocally,
  registerLocalPurge,
  rememberDeleteAt,
  runConfirmedLocalPurge,
  type ConfirmDeps,
  type ServerTradeAnswer,
} from '../src/chat/localPurge.js';
import { SelfDestructNotice, selfDestructText, useSelfDestruct } from '../src/screens/trade/SelfDestruct.js';
import { render } from './render.js';

const CODE = '7Q3M-K9TA-XR2B-4WNE';
const OTHER = 'H8D2-PQ4M-9ZX3-RT6V';
const AT = '2026-12-06T10:00:00.000Z';
const ms = (iso: string): number => Date.parse(iso);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the notice line', () => {
  it('no line while the trade has no date (open, or a dispute still open)', () => {
    expect(selfDestructText({ deleteAt: null, dispute: null })).toBeNull();
    expect(selfDestructText({ dispute: null })).toBeNull();
    expect(render(<SelfDestructNotice view={{ deleteAt: null, dispute: null }} />).host.innerHTML).toBe('');
  });

  it('an ended trade: "This trade self-destructs on <date>." with the server\'s date', () => {
    expect(selfDestructText({ deleteAt: AT, dispute: null })).toBe('This trade self-destructs on 6 Dec 2026.');
    const { host } = render(<SelfDestructNotice view={{ deleteAt: AT, dispute: null }} />);
    expect(host.textContent).toBe('This trade self-destructs on 6 Dec 2026.');
    expect(host.querySelector('time')!.getAttribute('datetime')).toBe(AT);
  });

  it('a disputed trade says why it is kept longer', () => {
    const view = { deleteAt: AT, dispute: { by: 'buyer' as const, at: '2026-09-01T00:00:00.000Z' } };
    expect(selfDestructText(view)).toBe('Kept until 6 Dec 2026 because a dispute was opened.');
    expect(render(<SelfDestructNotice view={view} />).host.textContent).toBe('Kept until 6 Dec 2026 because a dispute was opened.');
  });
});

describe('parseTradeView', () => {
  const base = {
    amountAtomic: '1', fiatCents: '1', maxFiatCents: '1', receivedAtomic: '0', lockedRate: { currency: 'USD', centsPerXmr: '1' },
    grown: null, funding: null,
  };
  it('takes an ISO deleteAt, null or none, and refuses anything else', () => {
    expect(parseTradeView({ ...base, deleteAt: AT }).deleteAt).toBe(AT);
    expect(parseTradeView({ ...base, deleteAt: null }).deleteAt).toBeNull();
    expect(parseTradeView(base).deleteAt).toBeUndefined();
    expect(() => parseTradeView({ ...base, deleteAt: 'soon' })).toThrow(TradeShapeError);
    expect(() => parseTradeView({ ...base, deleteAt: 5 })).toThrow(TradeShapeError);
  });
});

describe('localPurge', () => {
  it('remembers the date, and deletes every x2f key naming the trade once it has passed, nothing else', async () => {
    rememberDeleteAt(CODE, AT);
    localStorage.setItem(`x2f.fund.opened.${CODE}`, '1');
    localStorage.setItem(`x2f.warned.release.${CODE}`, '1');
    sessionStorage.setItem(`x2f.courtesy-sheet.shown:${CODE}`, '1');
    localStorage.setItem(`x2f.fund.opened.${OTHER}`, '1');
    localStorage.setItem('x2f.welcome.seen', '1');
    localStorage.setItem(`other.${CODE}`, 'not ours');
    expect(localPurgeDue(ms(AT) - 1)).toEqual([]);
    expect(localPurgeDue(ms(AT))).toEqual([CODE]);
    await purgeTradeLocally(CODE);
    expect(localStorage.getItem(`x2f.fund.opened.${CODE}`)).toBeNull();
    expect(localStorage.getItem(`x2f.warned.release.${CODE}`)).toBeNull();
    expect(sessionStorage.getItem(`x2f.courtesy-sheet.shown:${CODE}`)).toBeNull();
    expect(localStorage.getItem(`x2f.fund.opened.${OTHER}`)).toBe('1');
    expect(localStorage.getItem('x2f.welcome.seen')).toBe('1');
    expect(localStorage.getItem(`other.${CODE}`)).toBe('not ours');
    expect(localStorage.getItem(DELETE_AT_KEY)).toBeNull();
  });

  it('a registered store deletes its own copy of the trade (one failing never keeps the others)', async () => {
    const seen: string[] = [];
    const offA = registerLocalPurge('a', () => {
      throw new Error('broken store');
    });
    const offB = registerLocalPurge('b', (code) => {
      seen.push(code);
    });
    try {
      localStorage.setItem(`x2f.fund.opened.${CODE}`, '1');
      await purgeTradeLocally(CODE);
      expect(seen).toEqual([CODE]);
      expect(localStorage.getItem(`x2f.fund.opened.${CODE}`)).toBeNull();
    } finally {
      offA();
      offB();
    }
  });

  it('null forgets the date (a trade escalated again has none); a bad date is ignored', () => {
    rememberDeleteAt(CODE, AT);
    rememberDeleteAt(CODE, null);
    expect(localPurgeDue(ms(AT) + 1)).toEqual([]);
    rememberDeleteAt(CODE, 'soon');
    expect(localPurgeDue(ms(AT) + 1)).toEqual([]);
  });

  it('a stored map that is not ours is treated as empty', () => {
    localStorage.setItem(DELETE_AT_KEY, '[1,2]');
    expect(localPurgeDue(ms(AT) + 1)).toEqual([]);
    localStorage.setItem(DELETE_AT_KEY, '{nope');
    expect(localPurgeDue(ms(AT) + 1)).toEqual([]);
  });
});

describe('runConfirmedLocalPurge (start-up)', () => {
  const deps = (serverNow: number | null, answers: Record<string, ServerTradeAnswer>): ConfirmDeps => ({
    serverNow: async () => serverNow,
    trade: async (code) => answers[code] ?? { kind: 'unknown' },
  });

  it('by the server\'s clock, never the device\'s: nothing goes when the server time cannot be read', async () => {
    rememberDeleteAt(CODE, AT);
    localStorage.setItem(`x2f.fund.opened.${CODE}`, '1');
    expect(await runConfirmedLocalPurge(deps(null, { [CODE]: { kind: 'gone' } }))).toEqual([]);
    expect(await runConfirmedLocalPurge(deps(ms(AT) - 1, { [CODE]: { kind: 'gone' } }))).toEqual([]);
    expect(localStorage.getItem(`x2f.fund.opened.${CODE}`)).toBe('1');
  });

  it('a trade the server no longer has (404) goes from the device', async () => {
    rememberDeleteAt(CODE, AT);
    localStorage.setItem(`x2f.fund.opened.${CODE}`, '1');
    expect(await runConfirmedLocalPurge(deps(ms(AT) + 1, { [CODE]: { kind: 'gone' } }))).toEqual([CODE]);
    expect(localStorage.getItem(`x2f.fund.opened.${CODE}`)).toBeNull();
  });

  it('a trade whose view now has no date (escalated again) is kept and its date forgotten; no answer keeps everything', async () => {
    rememberDeleteAt(CODE, AT);
    rememberDeleteAt(OTHER, AT);
    localStorage.setItem(`x2f.fund.opened.${CODE}`, '1');
    localStorage.setItem(`x2f.fund.opened.${OTHER}`, '1');
    const done = await runConfirmedLocalPurge(
      deps(ms(AT) + 1, { [CODE]: { kind: 'view', deleteAt: null, serverNow: new Date(ms(AT) + 1).toISOString() }, [OTHER]: { kind: 'unknown' } }),
    );
    expect(done).toEqual([]);
    expect(localStorage.getItem(`x2f.fund.opened.${CODE}`)).toBe('1');
    expect(localStorage.getItem(`x2f.fund.opened.${OTHER}`)).toBe('1');
    expect(localPurgeDue(ms(AT) + 1)).toEqual([OTHER]);
  });

  it('a view whose date has passed by its own serverNow goes too', async () => {
    rememberDeleteAt(CODE, AT);
    localStorage.setItem(`x2f.fund.opened.${CODE}`, '1');
    const after = new Date(ms(AT) + 5).toISOString();
    expect(await runConfirmedLocalPurge(deps(ms(AT) + 1, { [CODE]: { kind: 'view', deleteAt: AT, serverNow: after } }))).toEqual([CODE]);
    expect(localStorage.getItem(`x2f.fund.opened.${CODE}`)).toBeNull();
  });
});

describe('useSelfDestruct (the trade room)', () => {
  function Probe({ at, clock }: { at: string | null; clock: () => Date }) {
    const { gone } = useSelfDestruct(CODE, { deleteAt: at }, clock);
    return <p>{gone ? 'gone' : 'here'}</p>;
  }
  const flush = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  it('remembers the date while it is ahead, and deletes this device\'s copies once the server clock passes it', async () => {
    localStorage.setItem(`x2f.fund.opened.${CODE}`, '1');
    const before = render(<Probe at={AT} clock={() => new Date(ms(AT) - 60_000)} />);
    await flush();
    expect(before.host.textContent).toBe('here');
    expect(localPurgeDue(ms(AT))).toEqual([CODE]);
    expect(localStorage.getItem(`x2f.fund.opened.${CODE}`)).toBe('1');
    before.unmount();
    const after = render(<Probe at={AT} clock={() => new Date(ms(AT) + 1)} />);
    await flush();
    expect(after.host.textContent).toBe('gone');
    expect(localStorage.getItem(`x2f.fund.opened.${CODE}`)).toBeNull();
    expect(localPurgeDue(ms(AT) + 1)).toEqual([]);
  });

  it('no date: nothing is remembered or deleted', async () => {
    localStorage.setItem(`x2f.fund.opened.${CODE}`, '1');
    const r = render(<Probe at={null} clock={() => new Date(ms(AT) + 1)} />);
    await flush();
    expect(r.host.textContent).toBe('here');
    expect(localStorage.getItem(`x2f.fund.opened.${CODE}`)).toBe('1');
  });
});

describe('in the trade room', () => {
  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  async function openRoom(body: unknown) {
    const client: EscrowClient = { start: vi.fn(), act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined };
    setEscrowClient(client);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)));
    const r = render(
      <MemoryRouter initialEntries={[`/trade/${CODE}`]}>
        <Routes>
          <Route path="/trade/:code" element={<TradeRoom />} />
        </Routes>
      </MemoryRouter>,
    );
    for (let i = 0; i < 6; i++) await act(async () => await Promise.resolve());
    return r;
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    setEscrowClient(null);
  });

  it('an ended trade shows its self-destruct date under the screen', async () => {
    const r = await openRoom({ ...sellerView(), code: CODE, state: 'released', closedAt: '2026-11-06T10:00:00.000Z', deleteAt: AT, serverNow: '2026-11-07T10:00:00.000Z' });
    expect(r.host.querySelector('[data-part="self-destruct"]')?.textContent).toBe('This trade self-destructs on 6 Dec 2026.');
  });

  it('an open trade shows none', async () => {
    const r = await openRoom({ ...sellerView(), code: CODE, deleteAt: null });
    expect(r.host.querySelector('[data-screen="trade"]')).not.toBeNull();
    expect(r.host.querySelector('[data-part="self-destruct"]')).toBeNull();
  });

  it('past the date by the server clock, the room shows the trade gone from this device', async () => {
    const r = await openRoom({ ...sellerView(), code: CODE, state: 'released', closedAt: '2026-11-06T10:00:00.000Z', deleteAt: AT, serverNow: '2026-12-07T10:00:00.000Z' });
    for (let i = 0; i < 6; i++) await act(async () => await Promise.resolve());
    expect(r.host.querySelector('[data-screen="trade"]')?.getAttribute('data-trade-state')).toBe('self-destructed');
  });
});

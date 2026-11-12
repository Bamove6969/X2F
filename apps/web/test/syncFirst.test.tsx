// @vitest-environment happy-dom
// C-021 (owner p11-33, 9 Nov): "When a device becomes active again (website, Android web app or
// app) it syncs first: every change is pushed before the user can act (a few seconds)." The
// sync-first gate: on resume the app pulls fresh state (and flushes anything queued) before the
// actions that change state work again; reading never waits, and a timeout never leaves the
// person stuck (the stale state is said plainly, with Try again).
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeView } from '../src/api/trade.js';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import '../src/screens/trade/screens.js';
import { TradeRoom } from '../src/screens/trade/TradeRoom.js';
import {
  ONLINE_DEBOUNCE_MS,
  RESUME_AFTER_HIDDEN_MS,
  SYNC_COPY,
  SYNC_TIMEOUT_MS,
  getSyncPhase,
  registerResumeSync,
  resetSyncFirst,
  syncNow,
  watchResume,
} from '../src/session/syncFirst.js';
import { refreshSession } from '../src/session/useSession.js';
import { PostOffer } from '../src/screens/PostOffer.js';
import { HoldButton } from '../src/ui/HoldButton.js';
import { SyncGate, syncGated } from '../src/ui/SyncGate.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { fire, render } from './render.js';

afterEach(() => {
  resetSyncFirst();
  vi.useRealTimers();
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

describe('syncNow: every registered sync, then ready; a failure or the timeout, stale', () => {
  it('syncing while the pulls run, ready once they all succeed', async () => {
    let done!: () => void;
    const pull = vi.fn(() => new Promise<void>((r) => (done = r)));
    const flushQueue = vi.fn(async () => undefined);
    registerResumeSync(pull);
    registerResumeSync(flushQueue);
    const p = syncNow();
    expect(getSyncPhase()).toBe('syncing');
    expect(pull).toHaveBeenCalledOnce();
    expect(flushQueue).toHaveBeenCalledOnce();
    done();
    expect(await p).toBe('ready');
    expect(getSyncPhase()).toBe('ready');
  });

  it('stale when any pull fails (or throws at once)', async () => {
    registerResumeSync(async () => undefined);
    const off = registerResumeSync(async () => {
      throw new Error('offline');
    });
    expect(await syncNow()).toBe('stale');
    off();
    registerResumeSync(() => {
      throw new Error('sync');
    });
    expect(await syncNow()).toBe('stale');
  });

  it(`stale after SYNC_TIMEOUT_MS (${SYNC_TIMEOUT_MS} ms): a pull that hangs never leaves the person stuck`, async () => {
    vi.useFakeTimers();
    registerResumeSync(() => new Promise(() => undefined));
    const p = syncNow();
    await vi.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS - 1);
    expect(getSyncPhase()).toBe('syncing');
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe('stale');
  });

  it('a later sync wins over one still running; an unregistered sync is not run', async () => {
    let first!: (v?: unknown) => void;
    const off = registerResumeSync(vi.fn(() => new Promise((r) => (first = r))));
    const a = syncNow();
    off();
    const b = syncNow();
    expect(await b).toBe('ready');
    first();
    await a;
    expect(getSyncPhase()).toBe('ready');
  });

  it('nothing registered: ready at once', async () => {
    expect(await syncNow()).toBe('ready');
  });
});

describe('watchResume: what counts as becoming active again', () => {
  let visibility: DocumentVisibilityState;
  let now: number;
  beforeEach(() => {
    visibility = 'visible';
    now = 1_000_000;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  });
  const show = (state: DocumentVisibilityState) => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it(`back from the background after ${RESUME_AFTER_HIDDEN_MS} ms or more, back online, a page restored from the back-forward cache, a frozen page resumed`, async () => {
    const sync = vi.fn(async () => undefined);
    registerResumeSync(sync);
    const stop = watchResume({ now: () => now });
    show('hidden');
    now += RESUME_AFTER_HIDDEN_MS - 1;
    show('visible');
    expect(sync).not.toHaveBeenCalled();
    show('hidden');
    now += RESUME_AFTER_HIDDEN_MS;
    show('visible');
    expect(sync).toHaveBeenCalledTimes(1);
    await flush();
    now += ONLINE_DEBOUNCE_MS;
    window.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(2);
    await flush();
    const restored = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    const fresh = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(fresh, 'persisted', { value: false });
    window.dispatchEvent(fresh);
    expect(sync).toHaveBeenCalledTimes(3);
    await flush();
    document.dispatchEvent(new Event('resume'));
    expect(sync).toHaveBeenCalledTimes(4);
    await flush();
    stop();
    now += ONLINE_DEBOUNCE_MS;
    window.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(4);
  });

  it(`review S3: back online syncs at most once per ${ONLINE_DEBOUNCE_MS} ms, and not while a sync is already running`, async () => {
    let finish!: () => void;
    const sync = vi.fn(() => new Promise<void>((r) => (finish = r)));
    registerResumeSync(sync);
    const stop = watchResume({ now: () => now });
    const t0 = now;
    window.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(1);
    now = t0 + 1_000;
    window.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    expect(getSyncPhase()).toBe('ready');
    // Settled, but still within the window of the last online sync: a flaky link holds nothing again.
    now = t0 + ONLINE_DEBOUNCE_MS - 1;
    window.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(1);
    now = t0 + ONLINE_DEBOUNCE_MS;
    window.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(2);
    // A sync already running: online is ignored however long ago the last one was.
    now = t0 + 3 * ONLINE_DEBOUNCE_MS;
    window.dispatchEvent(new Event('online'));
    expect(sync).toHaveBeenCalledTimes(2);
    finish();
    await flush();
    stop();
  });
});

describe('SyncGate: reading never waits; the actions that change state do', () => {
  function gate(gated?: boolean, at = '/trade/7F3A-9C21-4FTR-8WPN') {
    const act1 = vi.fn();
    const r = render(
      <MemoryRouter initialEntries={[at]}>
        <SyncGate {...(gated === undefined ? {} : { gated })} />
        <main>
          <p data-part="reading">0.500000 XMR</p>
          <button type="button" onClick={act1}>
            Release
          </button>
          <a href="#chat" data-part="chat-link">
            Chat
          </a>
          <textarea aria-label="Message" />
        </main>
      </MemoryRouter>,
    );
    const button = () => [...r.host.querySelectorAll('button')].find((b) => b.textContent === 'Release')!;
    const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    return { ...r, act1, button, click };
  }

  it('holds only the screens whose actions change a trade or an offer', () => {
    for (const p of ['/trade/7F3A-9C21-4FTR-8WPN', '/trade/7F3A-9C21-4FTR-8WPN/dispute', '/post', '/profile/offers', '/sell/zelle', '/buy/zelle/1f0c']) expect(syncGated(p), p).toBe(true);
    for (const p of ['/sell', '/buy', '/news', '/wallets', '/settings/security', '/account/frozen', '/']) expect(syncGated(p), p).toBe(false);
  });

  it('a screen it does not hold: no banner and actions work while syncing', async () => {
    let done!: () => void;
    registerResumeSync(() => new Promise<void>((r) => (done = r)));
    const g = gate(undefined, '/news');
    let p!: Promise<unknown>;
    act(() => {
      p = syncNow();
    });
    expect(g.host.querySelector('[data-part="sync-gate"]')).toBeNull();
    g.click(g.button());
    expect(g.act1).toHaveBeenCalledOnce();
    await act(async () => {
      done();
      await p;
    });
  });

  it('ready: nothing shown, actions work', () => {
    const g = gate();
    expect(g.host.querySelector('[data-part="sync-gate"]')).toBeNull();
    g.click(g.button());
    expect(g.act1).toHaveBeenCalledOnce();
  });

  it('syncing: "Updating…" shown, the page still reads, an action is held (disabled, and a click does nothing); then it works', async () => {
    let done!: () => void;
    registerResumeSync(() => new Promise<void>((r) => (done = r)));
    const g = gate();
    let p!: Promise<unknown>;
    act(() => {
      p = syncNow();
    });
    const status = g.host.querySelector('[data-part="sync-gate"]');
    expect(status?.closest('[role="status"]')).not.toBeNull();
    expect(status?.textContent).toBe(SYNC_COPY.updating);
    expect(g.host.querySelector('[data-part="reading"]')?.textContent).toBe('0.500000 XMR');
    expect(document.documentElement.hasAttribute('data-sync-held')).toBe(true);
    g.click(g.button());
    expect(g.act1).not.toHaveBeenCalled();
    // Typing is never held: a space in a field still types.
    const typing = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' });
    fire(g.host.querySelector('textarea')!, typing);
    expect(typing.defaultPrevented).toBe(false);
    // A link still goes where it goes (reading: the chat, the dispute).
    const link = g.host.querySelector('[data-part="chat-link"]')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    fire(link, ev);
    expect(ev.defaultPrevented).toBe(false);
    await act(async () => {
      done();
      await p;
    });
    expect(g.host.querySelector('[data-part="sync-gate"]')).toBeNull();
    expect(document.documentElement.hasAttribute('data-sync-held')).toBe(false);
    g.click(g.button());
    expect(g.act1).toHaveBeenCalledOnce();
  });

  it('review S2: the live region is on the page before the sync and "Updating…" is put into it; main is busy and the held controls say they are disabled', async () => {
    let done!: () => void;
    registerResumeSync(() => new Promise<void>((r) => (done = r)));
    const g = gate();
    const live = g.host.querySelector('[data-part="sync-live"]');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.textContent).toBe('');
    const already = document.createElement('button');
    already.setAttribute('aria-disabled', 'true');
    g.host.querySelector('main')!.append(already);
    const main = g.host.querySelector('main')!;
    expect(main.hasAttribute('aria-busy')).toBe(false);
    let p!: Promise<unknown>;
    act(() => {
      p = syncNow();
    });
    // The same element, now filled: a screen reader announces the change.
    expect(g.host.querySelector('[data-part="sync-live"]')).toBe(live);
    expect(live?.textContent).toBe(SYNC_COPY.updating);
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(g.button().getAttribute('aria-disabled')).toBe('true');
    // A control that mounts during the sync (a sheet opening) is marked too.
    const late = document.createElement('button');
    main.append(late);
    await act(async () => {
      await Promise.resolve();
    });
    expect(late.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      done();
      await p;
    });
    expect(live?.isConnected).toBe(true);
    expect(live?.textContent).toBe('');
    expect(main.hasAttribute('aria-busy')).toBe(false);
    expect(g.button().hasAttribute('aria-disabled')).toBe(false);
    expect(late.hasAttribute('aria-disabled')).toBe(false);
    // One the screen itself had disabled stays disabled.
    expect(already.getAttribute('aria-disabled')).toBe('true');
  });

  it('stale (failed or timed out): said plainly, actions work again, and Try again syncs again', async () => {
    let fail = true;
    const pull = vi.fn(async () => {
      if (fail) throw new Error('offline');
    });
    registerResumeSync(pull);
    const g = gate();
    await act(async () => {
      await syncNow();
    });
    const alert = g.host.querySelector('[data-part="sync-stale"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain(SYNC_COPY.stale);
    g.click(g.button());
    expect(g.act1).toHaveBeenCalledOnce();
    fail = false;
    const again = [...alert.querySelectorAll('button')].find((b) => b.textContent === SYNC_COPY.retry)!;
    await act(async () => {
      fire(again, new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(pull).toHaveBeenCalledTimes(2);
    expect(g.host.querySelector('[data-part="sync-stale"]')).toBeNull();
  });
});

describe('SyncGate and the hold-to-release button (SellerConfirm, HoldButton)', () => {
  function holdRoom() {
    const done = vi.fn();
    const r = render(
      <MemoryRouter initialEntries={['/trade/7F3A-9C21-4FTR-8WPN']}>
        <SyncGate />
        <main>
          <HoldButton label="Release" holdingLabel="Keep holding" holdMs={1000} onComplete={done} />
        </main>
      </MemoryRouter>,
    );
    const btn = () => r.host.querySelector('.x2f-hold')!;
    return { ...r, done, btn };
  }
  const down = (el: Element) => fire(el, new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true }));
  const keyDown = (el: Element) => fire(el, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' }));

  it('while syncing a hold cannot start (pointer or keyboard), and one already running is stopped; after, it works', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    registerResumeSync(() => new Promise<void>((r) => (finish = r)));
    const g = holdRoom();
    // A hold already running when the sync begins is stopped (its release could otherwise fire mid-sync).
    down(g.btn());
    expect(g.btn().getAttribute('data-holding')).toBe('true');
    let p!: Promise<unknown>;
    act(() => {
      p = syncNow();
    });
    expect(g.btn().getAttribute('data-holding')).toBe('false');
    down(g.btn());
    keyDown(g.btn());
    expect(g.btn().getAttribute('data-holding')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(g.done).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await p;
    });
    down(g.btn());
    expect(g.btn().getAttribute('data-holding')).toBe('true');
  });
});

describe('SyncGate without a PointerEvent constructor (review info)', () => {
  it('a running hold is still stopped and the guard still installed', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    registerResumeSync(() => new Promise<void>((r) => (finish = r)));
    const done = vi.fn();
    const r = render(
      <MemoryRouter initialEntries={['/trade/7F3A-9C21-4FTR-8WPN']}>
        <SyncGate />
        <main>
          <HoldButton label="Release" holdingLabel="Keep holding" holdMs={1000} onComplete={done} />
        </main>
      </MemoryRouter>,
    );
    const btn = () => r.host.querySelector('.x2f-hold')!;
    fire(btn(), new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true }));
    expect(btn().getAttribute('data-holding')).toBe('true');
    vi.stubGlobal('PointerEvent', function NoPointerEvent() {
      throw new TypeError('Illegal constructor');
    });
    let p!: Promise<unknown>;
    act(() => {
      p = syncNow();
    });
    vi.unstubAllGlobals();
    expect(btn().getAttribute('data-holding')).toBe('false');
    expect(document.documentElement.hasAttribute('data-sync-held')).toBe(true);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    fire(btn(), click);
    expect(click.defaultPrevented).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(done).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await p;
    });
  });
});

describe('the trade room pulls its trade on resume', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const ME = { kind: 'trader', level: 'full', displayName: 'Calcium', member: { name: 'Aurora', roles: ['trades'] } };
  let reads: number;
  let down: boolean;
  const v = sellerView({ payBy: new Date(Date.parse(SERVER_NOW) + 25 * 60_000).toISOString() }) as TradeView;

  beforeEach(() => {
    reads = 0;
    down = false;
    setEscrowClient({ start: vi.fn(), act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/v1/account/me') return json(ME);
        if (String(url) === `/v1/trades/${v.code}`) {
          reads++;
          return down ? json({ error: 'internal' }, 500) : json(v);
        }
        if (String(url).endsWith('/confirmations')) return json({ confirmations: 10, target: 10 });
        return json(v);
      }),
    );
    refreshSession();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setEscrowClient(null);
    refreshSession();
  });

  it('a resume re-reads GET /v1/trades/:code before it is ready; a failed read is stale, never ready', async () => {
    render(
      <MemoryRouter initialEntries={[`/trade/${v.code}`]}>
        <Routes>
          <Route path="/trade/:code" element={<TradeRoom />} />
        </Routes>
      </MemoryRouter>,
    );
    await flush();
    const before = reads;
    let phase: unknown;
    await act(async () => {
      phase = await syncNow();
    });
    expect(reads).toBe(before + 1);
    expect(phase).toBe('ready');
    down = true;
    await act(async () => {
      phase = await syncNow();
    });
    expect(phase).toBe('stale');
  });
});

describe('review S1: Post offer reads its methods, prices and currencies again on resume', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let reads: Record<string, number>;
  let down: boolean;
  beforeEach(() => {
    reads = {};
    down = false;
    sessionStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://x2f.test');
        reads[url.pathname] = (reads[url.pathname] ?? 0) + 1;
        if (url.pathname === '/v1/account/me') return json({ error: 'not-authenticated' }, 401);
        if (down) return json({ error: 'internal' }, 500);
        if (url.pathname === '/v1/methods') return json({ live: [], all: [{ id: 'ZELLE', name: 'Zelle', giftCard: false }] });
        if (url.pathname === '/v1/price') {
          const currency = url.searchParams.get('currency');
          return json({ currency, centsPerXmr: '33000', exponent: 2, at: '2026-11-12T00:00:00.000Z', usdCentsPerXmr: '33000' });
        }
        if (url.pathname === '/v1/currencies') return json({ currencies: [{ code: 'USD', flag: '🇺🇸', available: true }] });
        return json({ error: 'not-found' }, 404);
      }),
    );
    refreshSession();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    refreshSession();
  });

  it('a resume reads GET /v1/methods, /v1/price and /v1/currencies again before it is ready; a failed read is stale', async () => {
    render(
      <MemoryRouter initialEntries={['/post?method=ZELLE&side=sell']}>
        <PostOffer />
      </MemoryRouter>,
    );
    await flush();
    const before = { ...reads };
    expect(before['/v1/methods']).toBeGreaterThan(0);
    expect(before['/v1/price']).toBeGreaterThan(0);
    expect(before['/v1/currencies']).toBeGreaterThan(0);
    let phase: unknown;
    await act(async () => {
      phase = await syncNow();
    });
    expect(phase).toBe('ready');
    for (const path of ['/v1/methods', '/v1/price', '/v1/currencies']) expect(reads[path], path).toBe(before[path]! + 1);
    down = true;
    await act(async () => {
      phase = await syncNow();
    });
    expect(phase).toBe('stale');
  });
});

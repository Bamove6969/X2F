// @vitest-environment happy-dom
// Settings, Preferences (owner-chosen scope, 26 Nov 2026): Start on and Preferred currency, saved
// on this device under `x2f.prefs` (prefs.ts), for the account owner and team members, no API call;
// and a read-only clock line (times stay in UTC, ui/dates.ts). Unset keeps the old behaviour (/sell,
// USD); a store that throws or holds junk never breaks a screen.
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Landing } from '../src/screens/auth/Landing.js';
import { CURRENCIES, currencyFrom } from '../src/screens/browse/api.js';
import { MethodList } from '../src/screens/browse/MethodList.js';
import { SELL_COPY } from '../src/screens/browse/SellCopy.js';
import { PreferencesSettings } from '../src/screens/settings/Preferences.js';
import { PREFS_KEY, readPrefs, resetPrefsMemory, startPath, writePrefs } from '../src/screens/settings/prefs.js';
import { PREFERENCES_PATH, settingsTabOf } from '../src/screens/settings/settingsCopy.js';
import { refreshSession } from '../src/session/useSession.js';
import { render } from './render.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const OWNER = { kind: 'trader', level: 'full', termsCurrent: true, displayName: 'Calcium', methods: ['password'], accountType: 'vendor', pendingChanges: null, member: null };
const MEMBER = { ...OWNER, member: { name: 'Aurora', roles: ['trades'] } };

let me: unknown = OWNER;
let calls: string[] = [];

beforeEach(() => {
  me = OWNER;
  calls = [];
  window.localStorage.clear();
  resetPrefsMemory();
  refreshSession();
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input);
    calls.push(url);
    if (url.split('?')[0] === '/v1/account/me') return json(200, me);
    return json(404, { error: 'not-found' });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  resetPrefsMemory();
  refreshSession();
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

function Where() {
  const { pathname, search } = useLocation();
  return <output data-part="where">{pathname + search}</output>;
}

/** Every localStorage call throws, as in a private window with storage blocked. */
function breakStorage() {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
}

async function openLanding(path = '/'): Promise<HTMLElement> {
  const { host } = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  await flush();
  await flush();
  return host;
}

describe('prefs.ts: saved on this device, safe when storage is missing', () => {
  it('reads nothing set by default, and writes JSON under x2f.prefs', () => {
    expect(readPrefs()).toEqual({});
    expect(startPath()).toBe('/sell');
    writePrefs({ startSide: 'buy' });
    writePrefs({ currency: 'EUR' });
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY)!)).toEqual({ startSide: 'buy', currency: 'EUR' });
    resetPrefsMemory();
    expect(readPrefs()).toEqual({ startSide: 'buy', currency: 'EUR' });
    expect(startPath()).toBe('/buy');
  });

  it('junk in the store reads as unset', () => {
    for (const raw of ['not json', 'null', '42', '[]', JSON.stringify({ startSide: 'up', currency: 'eur' }), JSON.stringify({ currency: '<script>' })]) {
      window.localStorage.setItem(PREFS_KEY, raw);
      resetPrefsMemory();
      expect(readPrefs(), raw).toEqual({});
      expect(startPath(), raw).toBe('/sell');
      expect(currencyFrom(''), raw).toBe('USD');
    }
  });

  it('a store that throws reads as unset, and a choice made then lasts in memory for the page', () => {
    breakStorage();
    expect(readPrefs()).toEqual({});
    expect(startPath()).toBe('/sell');
    expect(currencyFrom('')).toBe('USD');
    expect(() => writePrefs({ startSide: 'buy', currency: 'GBP' })).not.toThrow();
    expect(startPath()).toBe('/buy');
    expect(currencyFrom('')).toBe('GBP');
  });

  it('a window with no localStorage at all still renders the tab', async () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    try {
      const { host } = render(
        <MemoryRouter initialEntries={[PREFERENCES_PATH]}>
          <PreferencesSettings />
        </MemoryRouter>,
      );
      await flush();
      expect(host.querySelector('[data-part="preferences"]')).not.toBeNull();
      const select = host.querySelector<HTMLSelectElement>('[data-part="pref-currency-select"]')!;
      expect(select.value).toBe('USD');
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real);
    }
  });
});

describe('the Preferences tab', () => {
  it('is its own route under Settings, for the owner and for a team member', async () => {
    expect(settingsTabOf(PREFERENCES_PATH)).toBe('preferences');
    for (const who of [OWNER, MEMBER]) {
      me = who;
      refreshSession();
      const { host, unmount } = render(
        <MemoryRouter initialEntries={[PREFERENCES_PATH]}>
          <PreferencesSettings />
        </MemoryRouter>,
      );
      await flush();
      expect(host.querySelector('main')!.getAttribute('data-settings-tab')).toBe('preferences');
      expect(host.querySelector('[aria-current="page"]')!.textContent).toBe('Preferences');
      expect(host.querySelector('[data-owner-only]')).toBeNull();
      expect(host.querySelector('[data-part="preferences"]')).not.toBeNull();
      unmount();
    }
    // Nothing here is an API call beyond the session itself.
    expect(calls.filter((c) => !c.startsWith('/v1/account/me'))).toEqual([]);
  });

  it('shows the defaults when unset and saves each change on this device', async () => {
    const { host } = render(
      <MemoryRouter initialEntries={[PREFERENCES_PATH]}>
        <PreferencesSettings />
      </MemoryRouter>,
    );
    await flush();
    const radios = [...host.querySelectorAll<HTMLInputElement>('[data-part="pref-side-option"] input')];
    expect(radios.map((r) => [r.value, r.checked])).toEqual([
      ['sell', true],
      ['buy', false],
    ]);
    const select = host.querySelector<HTMLSelectElement>('[data-part="pref-currency-select"]')!;
    expect([...select.options].map((o) => o.value)).toEqual([...CURRENCIES]);
    expect(select.value).toBe('USD');
    expect(host.querySelector('[data-part="pref-saved"]')).toBeNull();
    // Nothing is written until a choice is made.
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();

    act(() => radios[1]!.click());
    expect(readPrefs().startSide).toBe('buy');
    expect(host.querySelector('[data-part="pref-saved"]')!.textContent).toBe('Saved on this device.');

    act(() => {
      select.value = 'BRL';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY)!)).toEqual({ startSide: 'buy', currency: 'BRL' });
  });

  it('says times are always shown in UTC, read-only', async () => {
    const { host } = render(
      <MemoryRouter initialEntries={[PREFERENCES_PATH]}>
        <PreferencesSettings />
      </MemoryRouter>,
    );
    await flush();
    const clock = host.querySelector('[data-part="pref-clock"]')!;
    expect(clock.textContent).toContain('Times are always shown in UTC, on every device, so screenshots match.');
    expect(clock.querySelector('input, select, button')).toBeNull();
  });
});

describe('Start on: the side "/" opens on', () => {
  it('unset, a signed-in trader goes on to /sell as before', async () => {
    const host = await openLanding();
    expect(host.querySelector('[data-part="where"]')!.textContent).toBe('/sell');
  });

  it('Buy chosen, "/" opens /buy; Sell chosen, /sell', async () => {
    writePrefs({ startSide: 'buy' });
    let host = await openLanding();
    expect(host.querySelector('[data-part="where"]')!.textContent).toBe('/buy');
    writePrefs({ startSide: 'sell' });
    refreshSession();
    host = await openLanding();
    expect(host.querySelector('[data-part="where"]')?.textContent).toBe('/sell');
  });

  it('a returnTo in the address still wins over the preference', async () => {
    writePrefs({ startSide: 'buy' });
    const host = await openLanding(`/?returnTo=${encodeURIComponent('/sell/ZELLE?currency=EUR')}`);
    expect(host.querySelector('[data-part="where"]')!.textContent).toBe('/sell/ZELLE?currency=EUR');
  });
});

describe('Preferred currency: what Browse picks when the address names none', () => {
  it('unset is USD; a saved currency is used; the address always wins', () => {
    expect(currencyFrom('')).toBe('USD');
    writePrefs({ currency: 'EUR' });
    expect(currencyFrom('')).toBe('EUR');
    expect(currencyFrom('?currency=GBP')).toBe('GBP');
    expect(currencyFrom('?currency=XXX')).toBe('EUR');
  });

  it('a saved currency the picker no longer offers falls back to USD', () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ currency: 'JPY' }));
    expect(currencyFrom('')).toBe('USD');
  });

  it('Browse asks for the saved currency and marks it chosen', async () => {
    writePrefs({ currency: 'CAD' });
    const { host } = render(
      <MemoryRouter initialEntries={['/sell']}>
        <MethodList side="sell" copy={SELL_COPY} />
      </MemoryRouter>,
    );
    await flush();
    expect(calls.some((c) => c.startsWith('/v1/methods?') && new URLSearchParams(c.split('?')[1]).get('currency') === 'CAD')).toBe(true);
    const chosen = host.querySelector('[role="radio"][aria-checked="true"]');
    expect(chosen?.textContent).toBe('CAD');
  });
});

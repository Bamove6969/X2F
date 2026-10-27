import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');
const NUDGE = 'Someone nudged you on X2F';
const TRADE = 'Something changed in a trade on X2F';
const ALERT = 'Something needs your attention';

type Listener = (e: unknown) => void;

interface Harness {
  listeners: Record<string, Listener>;
  shown: Array<{ title: string; options: Record<string, unknown> }>;
  opened: string[];
  focused: string[];
  clientsList: Array<{ url: string; focus(): Promise<unknown> }>;
  fetched: Array<{ url: string; init: Record<string, unknown> }>;
  fetchFails: boolean;
  dispatch(type: string, extra: Record<string, unknown>): Promise<void>;
}

/** Runs sw.js in a fresh context with a fake service-worker global. */
function load(): Harness {
  const h: Harness = {
    listeners: {}, shown: [], opened: [], focused: [], clientsList: [], fetched: [], fetchFails: false,
    async dispatch(type, extra) {
      const waits: Promise<unknown>[] = [];
      this.listeners[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => void waits.push(p) });
      await Promise.all(waits);
    },
  };
  const self = {
    location: { origin: 'https://x2f.test' },
    addEventListener: (type: string, fn: Listener) => void (h.listeners[type] = fn),
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => void h.shown.push({ title, options }),
    },
    clients: {
      matchAll: async () => h.clientsList,
      openWindow: async (url: string) => void h.opened.push(url),
      claim: async () => undefined,
    },
    skipWaiting: async () => undefined,
    fetch: async (url: string, init: Record<string, unknown>) => {
      h.fetched.push({ url, init });
      if (h.fetchFails) throw new TypeError('offline');
      return { ok: true };
    },
  };
  runInNewContext(SOURCE, { self, URL });
  return h;
}

const pushWith = (text: string | null) => ({ data: text === null ? null : { text: () => text } });

let h: Harness;
beforeEach(() => {
  h = load();
});

describe('sw.js final-alert seen-receipt', () => {
  it('after showing a trade push, posts the receipt (same origin, no body)', async () => {
    await h.dispatch('push', pushWith(TRADE));
    expect(h.shown).toHaveLength(1);
    expect(h.fetched).toEqual([{ url: '/v1/account/final-alert-seen', init: { method: 'POST', credentials: 'same-origin' } }]);
  });

  it('sends no receipt for a nudge', async () => {
    await h.dispatch('push', pushWith(NUDGE));
    expect(h.fetched).toEqual([]);
  });

  it('a failed receipt still shows the notification and does not reject', async () => {
    h.fetchFails = true;
    await h.dispatch('push', pushWith(TRADE));
    expect(h.shown).toHaveLength(1);
  });
});

describe('sw.js push', () => {
  it('shows the nudge text for the nudge payload', async () => {
    await h.dispatch('push', pushWith(NUDGE));
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]!.options.body).toBe(NUDGE);
    expect(h.shown[0]!.title).toBe('X2F');
  });

  it("shows the owner's alert text for the alert payload, with no receipt (review 2026-10-27, I3)", async () => {
    await h.dispatch('push', pushWith(ALERT));
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]!.options.body).toBe(ALERT);
    expect(h.fetched).toEqual([]);
  });

  it('shows the trade text for the trade payload', async () => {
    await h.dispatch('push', pushWith(TRADE));
    expect(h.shown[0]!.options.body).toBe(TRADE);
  });

  it.each([null, '', 'Trade X2F-7KQ4-M9TD: 1.25 XMR from mira', '<b>hi</b>'])(
    'shows only the fixed trade text for any other payload (%s)',
    async (text) => {
      await h.dispatch('push', pushWith(text));
      expect(h.shown).toHaveLength(1);
      expect(h.shown[0]!.options.body).toBe(TRADE);
      expect(JSON.stringify(h.shown[0])).not.toContain('X2F-7KQ4');
    },
  );

  it('a trade push has its own tag, so it never silently replaces a nudge in the tray (review 2026-10-27, minor 7)', async () => {
    // Replacing a same-tag notification skips the alert steps (no sound, no vibration) under the
    // Notifications standard, which would make a shown-but-silent final alert.
    await h.dispatch('push', pushWith(NUDGE));
    await h.dispatch('push', pushWith(TRADE));
    await h.dispatch('push', pushWith(ALERT));
    const tags = h.shown.map((n) => n.options.tag);
    expect(tags.every((tag) => typeof tag === 'string' && tag.length > 0)).toBe(true);
    expect(new Set(tags).size).toBe(3);
  });

  it('carries no data, image or link beyond /', async () => {
    await h.dispatch('push', pushWith(NUDGE));
    const opts = h.shown[0]!.options;
    expect(Object.keys(opts).sort()).toEqual(['body', 'tag']);
  });
});

describe('sw.js notificationclick', () => {
  it('closes the notification and opens / when no X2F window is open', async () => {
    let closed = false;
    await h.dispatch('notificationclick', { notification: { close: () => void (closed = true) } });
    expect(closed).toBe(true);
    expect(h.opened).toEqual(['/']);
  });

  it('focuses an open X2F window instead of opening another', async () => {
    const focused: string[] = [];
    h.clientsList.push(
      { url: 'https://elsewhere.example/', focus: async () => focused.push('elsewhere') },
      { url: 'https://x2f.test/trade/X', focus: async () => focused.push('x2f') },
    );
    await h.dispatch('notificationclick', { notification: { close: () => undefined } });
    expect(focused).toEqual(['x2f']);
    expect(h.opened).toEqual([]);
  });
});

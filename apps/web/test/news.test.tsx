// @vitest-environment happy-dom
// Plan 4 Task 28: the News page, the device-only seen mark, and News opening after login.
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterLogin } from '../src/screens/auth/authApi.js';
import { News } from '../src/screens/News.js';
import {
  NEWS_DISMISS_ENABLED,
  NEWS_SEEN_KEY,
  markSeen,
  readLastSeen,
  resetNewsStore,
  unseenOf,
  useNewsUnseen,
  type NewsItem,
} from '../src/screens/news-model.js';
import { fire, render } from './render.js';

const item = (id: number, day: number, title = `Message ${id}`, body = `Body ${id}`): NewsItem => ({
  id,
  title,
  body,
  publishedAt: new Date(Date.UTC(2026, 9, day, 9)).toISOString(),
  editedAt: null,
});

// Newest first, as the server sends them.
const ITEMS = [item(3, 29, 'Upgrade done', 'All systems are back.\nThanks for waiting.'), item(2, 28, 'Planned upgrade'), item(1, 20, 'Welcome')];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let news: { status: number; body: unknown };
let me: { status: number; body: unknown };
let calls: { url: string; method: string }[];

beforeEach(() => {
  window.localStorage.clear();
  resetNewsStore();
  news = { status: 200, body: { items: ITEMS, serverNow: '2026-10-29T12:00:00.000Z' } };
  me = { status: 200, body: { termsCurrent: true } };
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url === '/v1/news') return json(news.status, news.body);
      if (url === '/v1/account/me') return json(me.status, me.body);
      return json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

let where = '';
function Where() {
  const loc = useLocation();
  where = loc.pathname + loc.search;
  return null;
}

function page(path = '/news') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/news" element={<News />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const titles = (host: HTMLElement) => [...host.querySelectorAll('[data-part="news-item"] [data-part="news-title"]')].map((h) => h.textContent);
const newTitles = (host: HTMLElement) => [...host.querySelectorAll('[data-part="news-item"][data-new] [data-part="news-title"]')].map((h) => h.textContent);

describe('the News page', () => {
  it('lists messages newest first, each with its posted date; all new on a first visit; logged out works', async () => {
    const { host } = page();
    await settle();
    expect(titles(host)).toEqual(['Upgrade done', 'Planned upgrade', 'Welcome']);
    expect(newTitles(host)).toEqual(['Upgrade done', 'Planned upgrade', 'Welcome']);
    const times = [...host.querySelectorAll('[data-part="news-date"] time')].map((t) => t.getAttribute('datetime'));
    expect(times).toEqual(ITEMS.map((i) => i.publishedAt));
    // The News board: "New", then the date in the one format (ui/dates.ts).
    expect(host.querySelector('[data-part="news-date"]')!.textContent).toMatch(/^New\d+ \w{3} \d{4}, \d\d:\d\d UTC$/);
    expect(host.querySelector('[data-part="news-count"]')!.textContent).toBe('3 new · 3 posts');
    // Paragraphs keep the line breaks of the body.
    expect([...host.querySelectorAll('[data-part="news-item"]')][0]!.textContent).toContain('Thanks for waiting.');
    // Only the news was asked for: no session call, nothing sent back about reading.
    expect(calls).toEqual([{ url: '/v1/news', method: 'GET' }]);
    expect(host.querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('marks what it showed as seen on this device only; the next visit shows only newer ones as new', async () => {
    const first = page();
    await settle();
    expect(window.localStorage.getItem(NEWS_SEEN_KEY)).toBe('3');
    // Still marked New for the rest of this visit.
    expect(newTitles(first.host)).toHaveLength(3);
    first.unmount();

    news = { status: 200, body: { items: [item(4, 30, 'Fresh'), ...ITEMS], serverNow: '2026-10-30T12:00:00.000Z' } };
    const { host } = page();
    await settle();
    expect(newTitles(host)).toEqual(['Fresh']);
    expect(host.querySelector('[data-part="news-new"]')!.textContent).toBe('New');
    expect(host.querySelector('[data-part="news-count"]')!.textContent).toBe('1 new · 4 posts');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('says when nothing is new, and when there is no news', async () => {
    markSeen(3);
    const a = page();
    await settle();
    expect(newTitles(a.host)).toEqual([]);
    expect(a.host.querySelector('[data-part="news-count"]')!.textContent).toBe('All read · 3 posts');
    // Nothing new: the newest post is open, the others closed; read posts say "Read"; no Mark all as read.
    expect([...a.host.querySelectorAll('[data-part="news-item"] button[aria-expanded]')].map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false']);
    expect(a.host.querySelector('[data-part="news-date"]')!.textContent).toMatch(/^Read/);
    expect(a.host.querySelector('[data-part="news-mark-all"]')).toBeNull();
    a.unmount();
    news = { status: 200, body: { items: [], serverNow: '2026-10-29T12:00:00.000Z' } };
    const b = page();
    await settle();
    expect(b.host.querySelector('[data-part="news-count"]')!.textContent).toBe('No news yet');
    expect(b.host.querySelector('[data-part="news-list"]')).toBeNull();
  });

  it('the News board: posts open and close, every new one starts open, Mark all as read clears the marks', async () => {
    const { host } = page();
    await settle();
    const toggles = () => [...host.querySelectorAll<HTMLButtonElement>('[data-part="news-item"] button[aria-expanded]')];
    expect(toggles().map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'true', 'true']);
    fire(toggles()[1]!, new MouseEvent('click', { bubbles: true }));
    expect(toggles()[1]!.getAttribute('aria-expanded')).toBe('false');
    const body = host.querySelector<HTMLElement>(`#${toggles()[1]!.getAttribute('aria-controls')}`)!;
    expect(body.hidden).toBe(true);
    expect(host.querySelector('[aria-label="Close News"]')).not.toBeNull();
    fire(host.querySelector('[data-part="news-mark-all"]')!, new MouseEvent('click', { bubbles: true }));
    expect(newTitles(host)).toEqual([]);
    expect(host.querySelector('[data-part="news-count"]')!.textContent).toBe('All read · 3 posts');
    expect(host.querySelector('[data-part="news-mark-all"]')).toBeNull();
    // Still nothing sent anywhere about reading.
    expect(calls).toEqual([{ url: '/v1/news', method: 'GET' }]);
  });

  it('a failed load says so and retries; nothing is marked seen', async () => {
    news = { status: 503, body: { error: 'internal' } };
    const { host } = page();
    await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Could not load the news');
    expect(window.localStorage.getItem(NEWS_SEEN_KEY)).toBeNull();
    news = { status: 200, body: { items: ITEMS, serverNow: '2026-10-29T12:00:00.000Z' } };
    fire(host.querySelector('[data-part="news-retry"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(titles(host)).toHaveLength(3);
  });

  it('Continue goes on to returnTo (only inside the app), else to /sell', async () => {
    const a = page('/news?returnTo=%2Fwallets');
    await settle();
    fire(a.host.querySelector('[data-part="news-continue"]')!, new MouseEvent('click', { bubbles: true }));
    expect(where).toBe('/wallets');
    a.unmount();
    const b = page('/news?returnTo=https%3A%2F%2Fevil.example');
    await settle();
    fire(b.host.querySelector('[data-part="news-continue"]')!, new MouseEvent('click', { bubbles: true }));
    expect(where).toBe('/sell');
  });

  it('has no "Don\'t show me this again" checkbox: the owner has not decided', async () => {
    expect(NEWS_DISMISS_ENABLED).toBe(false);
    const { host } = page();
    await settle();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.textContent).not.toMatch(/show (me )?this again/i);
  });
});

describe('the seen mark', () => {
  it('never goes down, survives a reload, and ignores junk in storage', () => {
    markSeen(5);
    markSeen(2);
    expect(readLastSeen()).toBe(5);
    resetNewsStore();
    expect(readLastSeen()).toBe(5);
    for (const junk of ['-1', 'abc', '1e9', '', '99999999999999999']) {
      window.localStorage.setItem(NEWS_SEEN_KEY, junk);
      expect(readLastSeen(), junk).toBe(0);
    }
  });

  it('unseenOf keeps only higher ids', () => {
    expect(unseenOf(ITEMS, 2).map((i) => i.id)).toEqual([3]);
    expect(unseenOf(ITEMS, 0)).toHaveLength(3);
  });

  it('useNewsUnseen counts new messages and drops to 0 once the page marks them seen', async () => {
    let count = -1;
    function Probe() {
      count = useNewsUnseen();
      return null;
    }
    render(<Probe />);
    await settle();
    expect(count).toBe(3);
    act(() => markSeen(3));
    expect(count).toBe(0);
  });
});

describe('after login', () => {
  it('opens News first when something is new, carrying returnTo', async () => {
    const go: string[] = [];
    await afterLogin((to) => go.push(to), '/wallets');
    expect(go).toEqual(['/news?returnTo=%2Fwallets']);
  });

  it('goes straight on when everything was seen, or the news cannot be read', async () => {
    markSeen(3);
    const go: string[] = [];
    await afterLogin((to) => go.push(to), '/wallets');
    news = { status: 503, body: { error: 'internal' } };
    resetNewsStore();
    window.localStorage.clear();
    await afterLogin((to) => go.push(to), '/buy');
    expect(go).toEqual(['/wallets', '/buy']);
  });

  it('Terms first when they changed, then News, then returnTo', async () => {
    me = { status: 200, body: { termsCurrent: false } };
    const go: string[] = [];
    await afterLogin((to) => go.push(to), '/wallets');
    expect(go).toEqual([`/terms?returnTo=${encodeURIComponent('/news?returnTo=%2Fwallets')}`]);
  });
});

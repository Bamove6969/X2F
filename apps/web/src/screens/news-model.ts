import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client.js';

/**
 * Plan 4 Task 28: the News inbox (owner, 2026-10-29; spec 6.6). `GET /v1/news` lists the messages
 * newest first; whether one is new is kept on THIS device only (lead, 2026-10-29): the highest
 * message id the News page has shown here, in localStorage. Nothing about reading goes to the
 * server. Another device, or a cleared browser, shows every message as new again, which is the
 * safe side for what may be X2F's only channel to users.
 */

export interface NewsItem {
  id: number;
  title: string;
  body: string;
  publishedAt: string;
  editedAt: string | null;
}

export interface NewsList {
  items: NewsItem[];
  serverNow: string;
}

/**
 * "Don't show me this again" (design session 2 Nov, News board variant with-dont-show-again): shown
 * on the News page that opens after a login. Ticked, News no longer opens by itself after a login
 * on THIS device (a per-device preference in localStorage, like the seen mark; nothing goes to the
 * server). The posts stay readable at /news.
 */
export const NEWS_DISMISS_ENABLED = true;

export const NEWS_HIDE_KEY = 'x2f.news.hideAfterLogin';

/** Whether this device asked News not to open after a login. */
export function readHideAfterLogin(): boolean {
  try {
    return window.localStorage.getItem(NEWS_HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setHideAfterLogin(hide: boolean): void {
  try {
    if (hide) window.localStorage.setItem(NEWS_HIDE_KEY, '1');
    else window.localStorage.removeItem(NEWS_HIDE_KEY);
  } catch {
    // Private mode: News keeps opening after a login.
  }
}

export const NEWS_SEEN_KEY = 'x2f.news.lastSeenId';

/** The highest id this device has shown; 0 when none (or storage is blocked). */
export function readLastSeen(): number {
  try {
    const raw = window.localStorage.getItem(NEWS_SEEN_KEY);
    const n = raw !== null && /^[0-9]{1,16}$/.test(raw) ? Number(raw) : 0;
    return Number.isSafeInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** The messages newer than `lastSeen`. */
export function unseenOf(items: readonly NewsItem[], lastSeen: number): NewsItem[] {
  return items.filter((i) => i.id > lastSeen);
}

/** Reads `GET /v1/news`, keeping only well-formed items (newest first, as the server sends them). */
export async function fetchNews(signal?: AbortSignal): Promise<NewsList> {
  const raw = await api<unknown>('/v1/news', signal ? { signal } : {});
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const items = Array.isArray(r.items) ? r.items.filter(isItem) : [];
  return { items, serverNow: typeof r.serverNow === 'string' ? r.serverNow : new Date().toISOString() };
}

function isItem(x: unknown): x is NewsItem {
  if (x === null || typeof x !== 'object') return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.id === 'number' && Number.isSafeInteger(i.id) && i.id > 0 &&
    typeof i.title === 'string' && typeof i.body === 'string' &&
    typeof i.publishedAt === 'string' && Number.isFinite(Date.parse(i.publishedAt)) &&
    (i.editedAt === null || typeof i.editedAt === 'string')
  );
}

// A small store so the menu's count and the News page agree within one page load: the list is
// fetched once (again after REFRESH_MS), and `markSeen` updates every subscriber.
const REFRESH_MS = 5 * 60_000;
let cached: { items: NewsItem[]; at: number } | null = null;
let inflight: Promise<NewsItem[]> | null = null;
let lastSeen: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function seen(): number {
  lastSeen ??= readLastSeen();
  return lastSeen;
}

/** Marks every message up to `id` as seen on this device (never lowers the mark). */
export function markSeen(id: number): void {
  if (id <= seen()) return;
  lastSeen = id;
  try {
    window.localStorage.setItem(NEWS_SEEN_KEY, String(id));
  } catch {
    // Private mode: seen for this page load only.
  }
  emit();
}

/** The list, from the store when fresh. Failures give an empty list (the count just stays hidden). */
export function loadNews(now = Date.now()): Promise<NewsItem[]> {
  if (cached && now - cached.at < REFRESH_MS) return Promise.resolve(cached.items);
  inflight ??= fetchNews()
    .then(
      (l) => {
        cached = { items: l.items, at: Date.now() };
        emit();
        return l.items;
      },
      () => [] as NewsItem[],
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The store's list as just fetched by the News page (so the menu count follows it). */
export function rememberNews(items: NewsItem[]): void {
  cached = { items, at: Date.now() };
  emit();
}

let snapshot = { count: 0, items: null as NewsItem[] | null, seen: -1 };
function countSnapshot(): number {
  const items = cached?.items ?? null;
  const s = seen();
  if (snapshot.items !== items || snapshot.seen !== s) snapshot = { items, seen: s, count: items ? unseenOf(items, s).length : 0 };
  return snapshot.count;
}

/** How many messages are new on this device; 0 until the list is loaded. */
export function useNewsUnseen(): number {
  useEffect(() => void loadNews(), []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    countSnapshot,
  );
}

/**
 * After login: true when this device has not shown the newest message yet, unless this device
 * ticked "Don't show me this again" (readHideAfterLogin).
 */
export async function hasUnseenNews(): Promise<boolean> {
  if (readHideAfterLogin()) return false;
  try {
    const { items } = await fetchNews();
    rememberNews(items);
    return unseenOf(items, seen()).length > 0;
  } catch {
    return false;
  }
}

/** Tests only: forget the store and re-read storage. */
export function resetNewsStore(): void {
  cached = null;
  inflight = null;
  lastSeen = null;
  emit();
}

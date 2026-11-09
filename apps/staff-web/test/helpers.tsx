// Test helpers for the staff app: a render over react-dom/client and React's act (as apps/web's
// test/render.tsx), typing and clicking, and a fake staff API behind `fetch`.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];

afterEach(() => {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount());
    m.host.remove();
  }
  vi.unstubAllGlobals();
});

export function render(ui: ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => root.render(ui));
  return host;
}

/** Lets pending promises (the fake API's answers) and the renders they cause finish. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('nothing to click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  });
  await settle();
}

/** Ticks (or unticks) a checkbox the way the browser does: the element's own click toggles it and fires change. */
export async function tick(el: Element | null | undefined): Promise<void> {
  if (!(el instanceof HTMLInputElement)) throw new Error('not a checkbox');
  act(() => el.click());
  await settle();
}

/** Types into an input or textarea the way React notices (the native value setter, then input). */
export function typeInto(el: Element | null | undefined, value: string): void {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error('not a text field');
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function button(name: string | RegExp, within: ParentNode = document): HTMLButtonElement | undefined {
  return [...within.querySelectorAll('button')].find((b) => (typeof name === 'string' ? b.textContent?.trim() === name : name.test(b.textContent ?? '')));
}

export function field(label: string, within: ParentNode = document): HTMLInputElement | HTMLTextAreaElement {
  const l = [...within.querySelectorAll('label')].find((x) => x.textContent?.trim().startsWith(label));
  const id = l?.getAttribute('for');
  const el = id ? document.getElementById(id) : l?.querySelector('input, textarea');
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error(`no field labelled ${label}`);
  return el;
}

export interface Call {
  method: string;
  path: string;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

type Answer = { status?: number; body?: unknown } | ((body: unknown, path: string) => { status?: number; body?: unknown });

/**
 * A fake staff API: `routes` maps "METHOD /path" (`:x` matches one segment) to an answer; anything
 * else is 404 `not-found`. Every call is recorded in `calls`.
 */
export function fakeApi(routes: Record<string, Answer>): { calls: Call[]; set(route: string, a: Answer): void } {
  const table = new Map(Object.entries(routes));
  const calls: Call[] = [];
  const match = (method: string, path: string): Answer | undefined => {
    const bare = path.split('?')[0]!;
    for (const [k, a] of table) {
      const [m, p] = k.split(' ') as [string, string];
      if (m !== method) continue;
      const re = new RegExp(`^${p.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
      if (re.test(bare)) return a;
    }
    return undefined;
  };
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, credentials: init.credentials });
    const a = match(method, path);
    const r = a === undefined ? { status: 404, body: { error: 'not-found' } } : typeof a === 'function' ? a(body, path) : a;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls, set: (route, a) => void table.set(route, a) };
}

export const refused = (status: number, error: string, extra: Record<string, unknown> = {}) => ({ status, body: { error, ...extra } });

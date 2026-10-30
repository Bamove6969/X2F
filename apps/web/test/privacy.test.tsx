// @vitest-environment happy-dom
// Plan 7 Task 4: Settings → Privacy states the one retention rule from the shared constants, and
// only while the purge is actually on (review I2: nothing unbuilt, no backup promise).
import { DISPUTE_KEEP_DAYS, TRADE_KEEP_DAYS } from '@x2f/trade';
import { readFileSync } from 'node:fs';
import { URL as NodeURL, fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRIVACY_COPY, Privacy } from '../src/screens/settings/Privacy.js';
import { render } from './render.js';

afterEach(() => vi.unstubAllGlobals());

async function shown(answer: () => Promise<Response>): Promise<HTMLElement> {
  const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => answer());
  vi.stubGlobal('fetch', fetchMock);
  const { host } = render(<Privacy />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]![0])).toBe('/v1/privacy');
  return host;
}
const purge = (on: boolean) => () => Promise.resolve(new Response(JSON.stringify({ tradePurge: on }), { status: 200 }));

/** What no version of the page may say until it is built (review I2). */
function noUnbuiltPromises(text: string): void {
  expect(text).not.toMatch(/backup/i);
  expect(text).not.toMatch(/blur/i);
  expect(text).not.toMatch(/review/i);
  expect(text).not.toMatch(/proof/i);
  expect(text).not.toMatch(/training/i);
  expect(text).not.toMatch(/month/i);
}

describe('Privacy', () => {
  it('purge off (the production default): says trades are kept, and nothing about self-destructing on a date', async () => {
    const host = await shown(purge(false));
    const text = host.textContent ?? '';
    expect(text).toContain(PRIVACY_COPY.off[0]);
    expect(text).not.toContain(`${TRADE_KEEP_DAYS} days`);
    expect(text).not.toContain(`${DISPUTE_KEEP_DAYS} days`);
    expect(text).not.toMatch(/deleted/i);
    expect(host.querySelector('[data-part="privacy-stays"]')).toBeNull();
    noUnbuiltPromises(text);
    expect(host.querySelectorAll('input, select, button, textarea')).toHaveLength(0);
  });

  it('purge on: the rule with the numbers from the shared constants, and no choices', async () => {
    const host = await shown(purge(true));
    const text = host.textContent ?? '';
    expect(text).toContain(`self-destructs ${TRADE_KEEP_DAYS} days after it ends`);
    expect(text).toContain(`kept ${DISPUTE_KEEP_DAYS} days from that moment`);
    expect(text).toContain('Nobody can delete a trade early, not even X2F.');
    expect(text).not.toContain(PRIVACY_COPY.off[0]);
    noUnbuiltPromises(text);
    expect(host.querySelectorAll('input, select, button, textarea')).toHaveLength(0);
    expect(host.querySelector('h1')!.textContent).toBe(PRIVACY_COPY.title);
  });

  it('no answer: states nothing about trades, only that it could not load', async () => {
    const host = await shown(() => Promise.reject(new TypeError('offline')));
    expect(host.querySelector('[data-part="privacy-failed"]')!.textContent).toBe(PRIVACY_COPY.failed);
    expect(host.querySelector('[data-part="privacy-kept"]')).toBeNull();
    const bad = await shown(() => Promise.resolve(new Response(JSON.stringify({ tradePurge: 'yes' }), { status: 200 })));
    expect(bad.querySelector('[data-part="privacy-kept"]')).toBeNull();
  });

  it('types no number of days itself, promises no backup and never mentions a 6-month copy (Revision 2026-10-29b)', () => {
    const src = readFileSync(fileURLToPath(new NodeURL('../src/screens/settings/Privacy.tsx', import.meta.url)), 'utf8');
    const copy = src.slice(src.indexOf('export const PRIVACY_COPY'));
    expect(copy).not.toMatch(/\b(14|30|90)\b/);
    expect(copy).not.toMatch(/BACKUP_KEEP_DAYS/);
    noUnbuiltPromises(JSON.stringify(PRIVACY_COPY));
    expect((src.match(/COPY-UNSIGNED/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

// @vitest-environment happy-dom
// Plan 7 Task 3: the self-destruct date in the trade room and this device's copies going with it.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE_AT_KEY, localPurgeDue, purgeTradeLocally, registerLocalPurge, rememberDeleteAt, runLocalPurge } from '../src/chat/localPurge.js';
import { SelfDestructNotice, deleteDate, selfDestructText, useSelfDestruct } from '../src/screens/trade/SelfDestruct.js';
import { render } from './render.js';

const A = 'ABCD-EFGH-JKMN';
const B = 'PQRS-TVWX-YZ23';
const T = Date.parse('2026-11-30T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('localPurge', () => {
  it('remembers each trade\'s date and lists those whose time has come (server time)', () => {
    rememberDeleteAt(A, iso(T));
    rememberDeleteAt(B, iso(T + 1));
    expect(localPurgeDue(T - 1)).toEqual([]);
    expect(localPurgeDue(T)).toEqual([A]);
    rememberDeleteAt(A, null);
    expect(localPurgeDue(T + 1)).toEqual([B]);
    rememberDeleteAt(B, 'not a date');
    expect(localPurgeDue(T + 10)).toEqual([]);
    expect(localStorage.getItem(DELETE_AT_KEY)).toBeNull();
  });

  it('deletes every x2f key naming the trade, runs the registered stores, and keeps other trades', async () => {
    localStorage.setItem(`x2f.fund.opened.${A}`, '1');
    localStorage.setItem(`x2f.fund.funded.${A}`, '1');
    localStorage.setItem(`x2f.release-asked:${A}`, '5');
    sessionStorage.setItem(`x2f.confirmed:${A}`, '{}');
    localStorage.setItem(`x2f.fund.opened.${B}`, '1');
    localStorage.setItem('other.app', A);
    const seen: string[] = [];
    const off = registerLocalPurge('test-store', (code) => void seen.push(code));
    const offBad = registerLocalPurge('broken-store', () => Promise.reject(new Error('nope')));
    rememberDeleteAt(A, iso(T));
    rememberDeleteAt(B, iso(T + 1_000));

    expect(await runLocalPurge(T)).toEqual([A]);
    expect(seen).toEqual([A]);
    for (const k of [`x2f.fund.opened.${A}`, `x2f.fund.funded.${A}`, `x2f.release-asked:${A}`]) expect(localStorage.getItem(k)).toBeNull();
    expect(sessionStorage.getItem(`x2f.confirmed:${A}`)).toBeNull();
    expect(localStorage.getItem(`x2f.fund.opened.${B}`)).toBe('1');
    expect(localStorage.getItem('other.app')).toBe(A);
    expect(localPurgeDue(T + 1_000)).toEqual([B]);
    off();
    offBad();
    await purgeTradeLocally(B);
    expect(seen).toEqual([A]);
    expect(localStorage.getItem(DELETE_AT_KEY)).toBeNull();
  });
});

function Room({ code, deleteAt, dispute, now }: { code: string; deleteAt: string | null; dispute: boolean; now: () => Date }) {
  const view = { deleteAt, dispute: dispute ? { by: 'buyer' as const, at: iso(T - 5) } : null };
  const { gone } = useSelfDestruct(code, view, now);
  return gone ? <p data-part="gone">gone</p> : <SelfDestructNotice view={view} />;
}

describe('the self-destruct notice', () => {
  it('shows the server\'s date, and a dispute changes the line', () => {
    expect(selfDestructText({ deleteAt: null, dispute: null })).toBeNull();
    const at = iso(T);
    expect(selfDestructText({ deleteAt: at, dispute: null })).toBe(`This trade self-destructs on ${deleteDate(at)}.`);
    const { host, rerender } = render(<Room code={A} deleteAt={at} dispute={false} now={() => new Date(T - 60_000)} />);
    const line = host.querySelector('[data-part="self-destruct"]')!;
    expect(line.textContent).toBe(`This trade self-destructs on ${deleteDate(at)}.`);
    expect(line.querySelector('time')!.getAttribute('datetime')).toBe(at);
    expect(localPurgeDue(T)).toEqual([A]);
    rerender(<Room code={A} deleteAt={at} dispute={true} now={() => new Date(T - 60_000)} />);
    expect(host.querySelector('[data-part="self-destruct"]')!.textContent).toBe(`Kept until ${deleteDate(at)} because a dispute was opened.`);
  });

  it('no date (open trade, dispute pending): no line, nothing remembered', () => {
    const { host } = render(<Room code={A} deleteAt={null} dispute={false} now={() => new Date(T)} />);
    expect(host.querySelector('[data-part="self-destruct"]')).toBeNull();
    expect(localStorage.getItem(DELETE_AT_KEY)).toBeNull();
  });

  it('once the date passes (fake clock), the trade is gone from the room and from this device', async () => {
    vi.useFakeTimers();
    localStorage.setItem(`x2f.fund.funded.${A}`, '1');
    let now = T - 1_000;
    const { host } = render(<Room code={A} deleteAt={iso(T)} dispute={false} now={() => new Date(now)} />);
    expect(host.querySelector('[data-part="gone"]')).toBeNull();
    now = T;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(host.querySelector('[data-part="gone"]')).not.toBeNull();
    expect(localStorage.getItem(`x2f.fund.funded.${A}`)).toBeNull();
    expect(localPurgeDue(T + 1)).toEqual([]);
  });
});

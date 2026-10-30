// @vitest-environment happy-dom
// Plan 7 Task 3: the self-destruct date in the trade room and this device's copies going with it.
import { createHash } from 'node:crypto';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE_AT_KEY,
  accountTag,
  deleteAtAccount,
  localPurgeDue,
  purgeTradeLocally,
  registerLocalPurge,
  rememberDeleteAt,
  runConfirmedLocalPurge,
  runLocalPurge,
  type ConfirmDeps,
  type ServerTradeAnswer,
} from '../src/chat/localPurge.js';
import { SelfDestructNotice, deleteDate, selfDestructText, useSelfDestruct } from '../src/screens/trade/SelfDestruct.js';
import { render } from './render.js';

const A = 'ABCD-EFGH-JKMN';
const B = 'PQRS-TVWX-YZ23';
const T = Date.parse('2026-11-30T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
/** The tag `accountTag` must store (review R3-m3), made independently. */
const tagOf = (account: string, code: string) => createHash('sha256').update(`${account}:${code}`).digest('hex');

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

describe('the start-up purge waits for the server (review M1)', () => {
  const C = 'WXYZ-2345-6789';
  const ME = 'acct-1';
  const deps = (serverNow: number | null, answers: Record<string, ServerTradeAnswer>, me: string | null = ME): ConfirmDeps & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      serverNow: () => Promise.resolve(serverNow),
      accountId: () => Promise.resolve(me),
      trade: (code) => {
        asked.push(code);
        return Promise.resolve(answers[code] ?? { kind: 'unknown' });
      },
    };
  };

  it('never reads this device\'s clock: a device far in the future deletes nothing the server has not reached', async () => {
    vi.useFakeTimers({ now: T + 400 * 86_400_000 });
    localStorage.setItem(`x2f.fund.funded.${A}`, '1');
    rememberDeleteAt(A, iso(T));
    const d = deps(T - 1, { [A]: { kind: 'gone' } });
    expect(await runConfirmedLocalPurge(d)).toEqual([]);
    expect(d.asked).toEqual([]);
    expect(localStorage.getItem(`x2f.fund.funded.${A}`)).toBe('1');
  });

  it('no server time (offline, error): deletes nothing', async () => {
    rememberDeleteAt(A, iso(T));
    const d = deps(null, { [A]: { kind: 'gone' } });
    expect(await runConfirmedLocalPurge(d)).toEqual([]);
    expect(localPurgeDue(T)).toEqual([A]);
  });

  it('deletes only what the server confirms: gone (404), or a date still set and passed', async () => {
    for (const k of [A, B, C]) localStorage.setItem(`x2f.fund.funded.${k}`, '1');
    rememberDeleteAt(A, iso(T), tagOf(ME, A));
    rememberDeleteAt(B, iso(T));
    rememberDeleteAt(C, iso(T));
    const d = deps(T + 1, {
      [A]: { kind: 'gone' },
      [B]: { kind: 'view', deleteAt: iso(T), serverNow: iso(T + 1) },
      [C]: { kind: 'unknown' },
    });
    expect(await runConfirmedLocalPurge(d)).toEqual([A, B]);
    expect(localStorage.getItem(`x2f.fund.funded.${A}`)).toBeNull();
    expect(localStorage.getItem(`x2f.fund.funded.${B}`)).toBeNull();
    expect(localStorage.getItem(`x2f.fund.funded.${C}`)).toBe('1');
    expect(localPurgeDue(T + 1)).toEqual([C]);
  });

  it('a stale date (the trade was escalated by late funds, or the purge is off: no date now) is forgotten and the trade kept', async () => {
    localStorage.setItem(`x2f.fund.funded.${A}`, '1');
    localStorage.setItem(`x2f.fund.funded.${B}`, '1');
    rememberDeleteAt(A, iso(T));
    rememberDeleteAt(B, iso(T));
    const d = deps(T + 1, {
      [A]: { kind: 'view', deleteAt: null, serverNow: iso(T + 1) },
      [B]: { kind: 'view', deleteAt: iso(T + 90 * 86_400_000), serverNow: iso(T + 1) },
    });
    expect(await runConfirmedLocalPurge(d)).toEqual([]);
    expect(localStorage.getItem(`x2f.fund.funded.${A}`)).toBe('1');
    expect(localStorage.getItem(`x2f.fund.funded.${B}`)).toBe('1');
    expect(localPurgeDue(T + 1)).toEqual([]);
    expect(localPurgeDue(T + 90 * 86_400_000)).toEqual([B]);
  });

  it('a 404 is gone only for the account that saw the trade (review R2-m3: another account\'s session also gets 404)', async () => {
    const D = 'DDDD-2345-6789';
    for (const k of [A, B, C, D]) localStorage.setItem(`x2f.fund.funded.${k}`, '1');
    rememberDeleteAt(A, iso(T), tagOf('acct-other', A)); // seen by another account on this shared device
    rememberDeleteAt(B, iso(T)); // no account recorded (before R2-m3, or /me unreadable then)
    rememberDeleteAt(C, iso(T), tagOf(ME, C));
    rememberDeleteAt(D, iso(T), tagOf(ME, D));
    const gone = { kind: 'gone' } as const;
    expect(await runConfirmedLocalPurge(deps(T + 1, { [A]: gone, [B]: gone, [C]: gone, [D]: gone }, null))).toEqual([]);
    expect(await runConfirmedLocalPurge(deps(T + 1, { [A]: gone, [B]: gone, [C]: gone }))).toEqual([C]);
    for (const k of [A, B, D]) expect(localStorage.getItem(`x2f.fund.funded.${k}`)).toBe('1');
    expect(localStorage.getItem(`x2f.fund.funded.${C}`)).toBeNull();
    expect(localPurgeDue(T + 1)).toEqual([A, B, D]);
    // Account A's own session later confirms it.
    expect(await runConfirmedLocalPurge(deps(T + 1, { [A]: gone }, 'acct-other'))).toEqual([A]);
  });

  it('the room records the signed-in account with the date, and keeps it when the account cannot be read (review R2-m3)', async () => {
    const { rerender } = render(<Room code={A} deleteAt={iso(T)} dispute={false} now={() => new Date(T - 60_000)} account={() => Promise.resolve(ME)} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(deleteAtAccount(A)).toBe(tagOf(ME, A));
    rerender(<Room code={A} deleteAt={iso(T + 1)} dispute={false} now={() => new Date(T - 60_000)} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(deleteAtAccount(A)).toBe(tagOf(ME, A));
    expect(localPurgeDue(T + 1)).toEqual([A]);
  });

  it('stores a one-way tag of account:code, never the account id (review R3-m3)', async () => {
    expect(await accountTag(ME, A)).toBe(tagOf(ME, A));
    expect(await accountTag(ME, A)).not.toBe(await accountTag(ME, B)); // no link from one trade code to another
    render(<Room code={A} deleteAt={iso(T)} dispute={false} now={() => new Date(T - 60_000)} account={() => Promise.resolve(ME)} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const raw = localStorage.getItem(DELETE_AT_KEY)!;
    expect(raw).toContain(tagOf(ME, A));
    expect(raw).not.toContain(ME);
    // A raw id passed (or stored by an older build) is never kept as the account.
    rememberDeleteAt(B, iso(T), ME);
    expect(deleteAtAccount(B)).toBeNull();
    expect(localStorage.getItem(DELETE_AT_KEY)!).not.toContain(ME);
  });

  it('a view with no date only because of site maintenance keeps the stored date (review R3-m2)', async () => {
    localStorage.setItem(`x2f.fund.funded.${A}`, '1');
    rememberDeleteAt(A, iso(T), tagOf(ME, A));
    const paused = { kind: 'view', deleteAt: null, serverNow: iso(T + 1), paused: true } as const;
    expect(await runConfirmedLocalPurge(deps(T + 1, { [A]: paused }))).toEqual([]);
    expect(localStorage.getItem(`x2f.fund.funded.${A}`)).toBe('1');
    expect(localPurgeDue(T + 1)).toEqual([A]);
    expect(deleteAtAccount(A)).toBe(tagOf(ME, A));
    // The room during maintenance: no line, nothing forgotten, nothing deleted.
    const { host } = render(<Room code={A} deleteAt={null} paused dispute={false} now={() => new Date(T + 1)} account={() => Promise.resolve(ME)} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('[data-part="self-destruct"]')).toBeNull();
    expect(host.querySelector('[data-part="gone"]')).toBeNull();
    expect(localPurgeDue(T + 1)).toEqual([A]);
    // Maintenance over: the server deleted the trade, and the next start-up cleans this device.
    expect(await runConfirmedLocalPurge(deps(T + 2, { [A]: { kind: 'gone' } }))).toEqual([A]);
    expect(localStorage.getItem(`x2f.fund.funded.${A}`)).toBeNull();
  });

  it('reads an entry stored as a bare date (before R2-m3) as one with no account', () => {
    const D2 = 'EEEE-2345-6789';
    const tag = tagOf(ME, B);
    localStorage.setItem(DELETE_AT_KEY, JSON.stringify({ [A]: iso(T), [B]: { at: iso(T), account: tag }, [C]: { at: 'nope' }, [D2]: { at: iso(T), account: ME } }));
    expect(localPurgeDue(T)).toEqual([A, B, D2]);
    expect(deleteAtAccount(A)).toBeNull();
    expect(deleteAtAccount(B)).toBe(tag);
    expect(deleteAtAccount(D2)).toBeNull(); // a raw account id (not a tag) is dropped on read (R3-m3)
  });
});

const NO_ACCOUNT = () => Promise.resolve(null);
function Room({ code, deleteAt, paused = false, dispute, now, account = NO_ACCOUNT }: { code: string; deleteAt: string | null; paused?: boolean; dispute: boolean; now: () => Date; account?: () => Promise<string | null> }) {
  const view = { deleteAt, deleteAtPaused: paused, dispute: dispute ? { by: 'buyer' as const, at: iso(T - 5) } : null };
  const { gone } = useSelfDestruct(code, view, now, account);
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

  it('purge off (the view has no date, review I1): no line and no self-destructed swap, even with a past date stored', async () => {
    localStorage.setItem(`x2f.fund.funded.${A}`, '1');
    rememberDeleteAt(A, iso(T - 1_000));
    const { host } = render(<Room code={A} deleteAt={null} dispute={false} now={() => new Date(T + 86_400_000)} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('[data-part="self-destruct"]')).toBeNull();
    expect(host.querySelector('[data-part="gone"]')).toBeNull();
    expect(localStorage.getItem(`x2f.fund.funded.${A}`)).toBe('1');
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

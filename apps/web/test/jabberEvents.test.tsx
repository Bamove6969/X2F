// @vitest-environment happy-dom
// W-021 (owner p11-27): the Jabber notifications settings page. One checkbox per event the server
// lists; ticking one calls the API for that event only; a refusal shows and the box goes back.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { AuthApiError, type JabberEvents, type JabberStatus } from '@x2f/auth-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from './render.js';

const api = vi.hoisted(() => ({
  getJabber: vi.fn(),
  getJabberEvents: vi.fn(),
  setJabberEvent: vi.fn(),
  setJabberEnabled: vi.fn(),
  listAlerts: vi.fn(async () => []),
  markAlertSeen: vi.fn(),
}));
vi.mock('../src/screens/auth/authApi.js', () => ({ authApi: api }));

const { JabberEventsScreen } = await import('../src/screens/settings/JabberEvents.js');
const { JabberAlerts } = await import('../src/screens/settings/Alerts.js');
const { JABBER_COPY } = await import('../src/screens/settings/jabberCopy.js');

const ON: JabberStatus = { available: true, state: 'on', address: 'mira…@xmpp.example.org', pendingAddress: null, lastSentAt: null };
const OFF: JabberStatus = { available: true, state: 'off', address: null, pendingAddress: null, lastSentAt: null };
const ALL: JabberEvents = { events: [{ kind: 'account-change', on: true, canTurnOff: false }, { kind: 'trade-attention', on: true, canTurnOff: true }] };

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});
const box = (host: HTMLElement, kind: string) => host.querySelector(`input[data-kind="${kind}"]`) as HTMLInputElement | null;

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.listAlerts.mockResolvedValue([]);
});

describe('JabberEventsScreen', () => {
  it('one labelled checkbox per event, in the server order, ticked as the server says', async () => {
    api.getJabber.mockResolvedValue(ON);
    api.getJabberEvents.mockResolvedValue({ events: [{ kind: 'account-change', on: true, canTurnOff: false }, { kind: 'trade-attention', on: false, canTurnOff: true }] });
    const { host } = render(<MemoryRouter><JabberEventsScreen /></MemoryRouter>);
    await flush();
    expect(host.querySelector('h1')!.textContent).toBe(JABBER_COPY.eventsTitle);
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => [b.dataset.kind, b.checked])).toEqual([['account-change', true], ['trade-attention', false]]);
    for (const b of boxes) {
      const label = host.querySelector(`label[for="${b.id}"]`);
      expect(label?.textContent, b.dataset.kind).toBeTruthy();
    }
    expect(host.textContent).toContain(JABBER_COPY.events['account-change'].label);
    expect(host.textContent).toContain(JABBER_COPY.events['trade-attention'].label);
  });

  it('unticking calls the API for that event only and shows what the server answered', async () => {
    api.getJabber.mockResolvedValue(ON);
    api.getJabberEvents.mockResolvedValue(ALL);
    api.setJabberEvent.mockResolvedValue({ events: [{ kind: 'account-change', on: true, canTurnOff: false }, { kind: 'trade-attention', on: false, canTurnOff: true }] });
    const { host } = render(<MemoryRouter><JabberEventsScreen /></MemoryRouter>);
    await flush();
    act(() => box(host, 'trade-attention')!.click());
    await flush();
    expect(api.setJabberEvent).toHaveBeenCalledTimes(1);
    expect(api.setJabberEvent).toHaveBeenCalledWith({ kind: 'trade-attention', on: false });
    expect(box(host, 'trade-attention')!.checked).toBe(false);
    expect(box(host, 'account-change')!.checked).toBe(true);
  });

  it('a refusal shows the shared words and the box keeps what the server has', async () => {
    api.getJabber.mockResolvedValue(ON);
    api.getJabberEvents.mockResolvedValue(ALL);
    api.setJabberEvent.mockRejectedValue(new AuthApiError(403, 'weak-session', {}));
    const { host } = render(<MemoryRouter><JabberEventsScreen /></MemoryRouter>);
    await flush();
    act(() => box(host, 'trade-attention')!.click());
    await flush();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(box(host, 'trade-attention')!.checked).toBe(true);
  });

  it('review F1: a security notice shows as always on, a disabled ticked box with the line that it cannot be turned off', async () => {
    api.getJabber.mockResolvedValue(ON);
    api.getJabberEvents.mockResolvedValue(ALL);
    const { host } = render(<MemoryRouter><JabberEventsScreen /></MemoryRouter>);
    await flush();
    const ac = box(host, 'account-change')!;
    expect(ac.checked).toBe(true);
    expect(ac.disabled).toBe(true);
    expect(box(host, 'trade-attention')!.disabled).toBe(false);
    act(() => ac.click());
    await flush();
    expect(api.setJabberEvent).not.toHaveBeenCalled();
    const note = host.querySelector('[data-part="jabber-events-always-on"]')!;
    expect(note.textContent).toBe(JABBER_COPY.alwaysOnNote);
    expect(ac.getAttribute('aria-describedby')).toContain(note.id);
  });

  it('with no proven address it sends the person to the set-up instead of showing boxes', async () => {
    api.getJabber.mockResolvedValue(OFF);
    api.getJabberEvents.mockResolvedValue(ALL);
    const { host } = render(<MemoryRouter><JabberEventsScreen /></MemoryRouter>);
    await flush();
    expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(host.querySelector('a[href="/settings/jabber"]')).not.toBeNull();
  });
});

describe('the Alerts section links to the events page once an address is proven', () => {
  it('shown when on or paused, not when not set up', async () => {
    api.getJabber.mockResolvedValue(ON);
    const on = render(<MemoryRouter><JabberAlerts /></MemoryRouter>);
    await flush();
    expect(on.host.querySelector('a[href="/settings/jabber/events"]')).not.toBeNull();
    on.unmount();
    api.getJabber.mockResolvedValue(OFF);
    const off = render(<MemoryRouter><JabberAlerts /></MemoryRouter>);
    await flush();
    expect(off.host.querySelector('a[href="/settings/jabber/events"]')).toBeNull();
  });
});

describe('the list follows the API (J-20 adds team-member-first-login)', () => {
  it('a third kind from the API gets its own labelled box; an unknown kind is never shown raw', async () => {
    api.getJabber.mockResolvedValue(ON);
    api.getJabberEvents.mockResolvedValue({
      events: [
        { kind: 'account-change', on: true, canTurnOff: false }, { kind: 'trade-attention', on: true, canTurnOff: true },
        { kind: 'team-member-first-login', on: true, canTurnOff: false }, { kind: 'future-kind', on: true, canTurnOff: true },
      ],
    });
    const { host } = render(<MemoryRouter><JabberEventsScreen /></MemoryRouter>);
    await flush();
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((b) => b.dataset.kind)).toEqual([
      'account-change', 'trade-attention', 'team-member-first-login', 'future-kind',
    ]);
    expect(host.textContent).toContain(JABBER_COPY.events['team-member-first-login'].label);
    expect(host.textContent).not.toContain('future-kind');
  });
});

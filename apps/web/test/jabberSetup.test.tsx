// @vitest-environment happy-dom
// Owner rule p5-7, boards JabberSetup and Alerts: the three set-up steps, the masked address, the
// exact preview sentence, and the Alerts section's switch.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { AuthApiError, type JabberStatus } from '@x2f/auth-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from './render.js';

const api = vi.hoisted(() => ({
  getJabber: vi.fn(),
  sendJabberTest: vi.fn(),
  verifyJabber: vi.fn(),
  setJabberEnabled: vi.fn(),
  turnOffJabber: vi.fn(),
  listAlerts: vi.fn(async () => []),
  markAlertSeen: vi.fn(),
}));
vi.mock('../src/screens/auth/authApi.js', () => ({ authApi: api }));

const { JabberSetup, jabberErrorText } = await import('../src/screens/settings/JabberSetup.js');
const { JabberAlerts } = await import('../src/screens/settings/Alerts.js');

const OFF: JabberStatus = { available: true, state: 'off', address: null, pendingAddress: null, lastSentAt: null };
const ON: JabberStatus = { available: true, state: 'on', address: 'mira…@xmpp.example.org', pendingAddress: null, lastSentAt: '2026-11-07T15:00:00.000Z' };

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});
const part = (host: HTMLElement, p: string) => host.querySelector(`[data-part="${p}"]`) as HTMLElement | null;
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = (el: HTMLElement) => act(() => el.click());

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.listAlerts.mockResolvedValue([]);
});

describe('JabberSetup', () => {
  it('address → test code → done, showing only the masked address and the exact message', async () => {
    api.getJabber.mockResolvedValue(OFF);
    api.sendJabberTest.mockResolvedValue({ pendingAddress: 'mira…@xmpp.example.org', resendAfterSeconds: 60 });
    api.verifyJabber.mockResolvedValue(ON);
    const { host } = render(<MemoryRouter><JabberSetup /></MemoryRouter>);
    await flush();
    expect(host.querySelector('h1')!.textContent).toBe('Secure Jabber alerts');
    type(host.querySelector('#js-jid') as HTMLInputElement, 'mira.lee@xmpp.example.org');
    click(part(host, 'jabber-send-test')!);
    await flush();
    expect(api.sendJabberTest).toHaveBeenCalledWith({ address: 'mira.lee@xmpp.example.org' });
    expect(host.textContent).toContain('Sent to mira…@xmpp.example.org. It can take a minute to arrive.');
    expect(host.textContent).not.toContain('mira.lee');
    type(host.querySelector('#js-code') as HTMLInputElement, '12a3456');
    expect((host.querySelector('#js-code') as HTMLInputElement).value).toBe('123456');
    click(part(host, 'jabber-turn-on')!);
    await flush();
    expect(api.verifyJabber).toHaveBeenCalledWith({ code: '123456' });
    expect(host.textContent).toContain('Jabber alerts are on');
    expect(host.textContent).toContain('Every account change now sends one short message to mira…@xmpp.example.org.');
    expect(part(host, 'jabber-preview-text')!.textContent).toBe('An account change was made on your X2F account.');
    expect(host.textContent).toContain('X2F alerts');
  });

  it('Turn off goes back to the address step', async () => {
    api.getJabber.mockResolvedValue(ON);
    api.turnOffJabber.mockResolvedValue(undefined);
    const { host } = render(<MemoryRouter><JabberSetup /></MemoryRouter>);
    await flush();
    expect(host.querySelector('[data-step]')!.getAttribute('data-step')).toBe('done');
    click(part(host, 'jabber-turn-off')!);
    await flush();
    expect(api.turnOffJabber).toHaveBeenCalled();
    expect(host.querySelector('[data-step]')!.getAttribute('data-step')).toBe('address');
  });

  it('says why: a bad address, a wrong or ended code, a short wait, no sending account', () => {
    const e = (code: string, extra: Record<string, unknown> = {}) => new AuthApiError(400, code as never, extra);
    expect(jabberErrorText(e('jabber-address-invalid'))).toMatch(/isn't a Jabber address/);
    expect(jabberErrorText(e('code-invalid'))).toMatch(/code isn't right/);
    expect(jabberErrorText(e('challenge-expired'))).toMatch(/Send a new test message/);
    expect(jabberErrorText(e('slow-down', { retryAfterSeconds: 42 }))).toBe('You can send another test message in 42 seconds.');
    expect(jabberErrorText(e('jabber-unavailable'))).toMatch(/coming to X2F soon/);
  });
});

describe('the Alerts section', () => {
  it('not set up: "Not set up" and no switch; hidden while the deployment has no sender', async () => {
    api.getJabber.mockResolvedValue(OFF);
    const { host } = render(<MemoryRouter><JabberAlerts /></MemoryRouter>);
    await flush();
    expect(part(host, 'jabber-address-row')!.textContent).toContain('Not set up');
    expect(part(host, 'jabber-switch')).toBeNull();
    api.getJabber.mockResolvedValue({ ...OFF, available: false });
    const other = render(<MemoryRouter><JabberAlerts /></MemoryRouter>);
    await flush();
    expect(part(other.host, 'jabber-alerts')).toBeNull();
  });

  it('set up: the masked address, the last message time, and a switch that turns it off', async () => {
    api.getJabber.mockResolvedValue(ON);
    api.setJabberEnabled.mockResolvedValue({ ...ON, state: 'paused' });
    const { host } = render(<MemoryRouter><JabberAlerts /></MemoryRouter>);
    await flush();
    expect(part(host, 'jabber-address-row')!.textContent).toContain('mira…@xmpp.example.org');
    expect(part(host, 'jabber-last')!.textContent).toContain('7 Nov 2026, 15:00 UTC');
    const sw = part(host, 'jabber-switch')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    click(sw);
    await flush();
    expect(api.setJabberEnabled).toHaveBeenCalledWith({ on: false });
    expect(part(host, 'jabber-switch')!.getAttribute('aria-checked')).toBe('false');
  });
});

describe('review M4: an address sealed under a removed key', () => {
  const BROKEN: JabberStatus = { available: true, state: 'broken', address: null, pendingAddress: null, lastSentAt: '2026-11-07T15:00:00.000Z' };

  it('Alerts says it needs setting up again, with no switch', async () => {
    api.getJabber.mockResolvedValue(BROKEN);
    const { host } = render(<MemoryRouter><JabberAlerts /></MemoryRouter>);
    await flush();
    expect(part(host, 'jabber-address-row')!.textContent).toContain('Needs setting up again');
    expect(part(host, 'jabber-address-row')!.textContent).not.toContain('Not set up');
    expect(part(host, 'jabber-switch')).toBeNull();
  });

  it('the set-up opens at the address step and says so, never "alerts are on"', async () => {
    api.getJabber.mockResolvedValue(BROKEN);
    const { host } = render(<MemoryRouter><JabberSetup /></MemoryRouter>);
    await flush();
    expect(host.querySelector('[data-step]')!.getAttribute('data-step')).toBe('address');
    expect(part(host, 'jabber-broken')!.textContent).toBe('Needs setting up again');
    expect(host.textContent).not.toContain('Jabber alerts are on');
  });
});

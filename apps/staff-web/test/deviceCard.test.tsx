// @vitest-environment happy-dom
// Chat membership design task 8 and 10: DeviceCard's faults. Lead call 18 Nov: when the crypto library
// cannot load in the chat key worker (its WebAssembly refused), the card says so, distinctly: never
// "X2F could not be reached". And "Confirm this device" is secondary, so ModCase keeps one primary.
import { describe, expect, it } from 'vitest';
import { ChatKeyError } from '../src/chat/types.js';
import { DeviceCard } from '../src/ui/DeviceCard.js';
import { button, fakeApi, render, settle } from './helpers.js';

const part = (p: string) => document.querySelector(`[data-part="${p}"]`);

describe('DeviceCard', () => {
  it('the crypto library did not load: its own fault, not the network\'s, nor the no-storage one', async () => {
    fakeApi({});
    render(<DeviceCard load={() => Promise.reject(new ChatKeyError('crypto-unavailable'))} />);
    await settle();
    const t = part('device-fault')?.textContent ?? '';
    expect(t).toContain('could not load the encryption');
    expect(t).not.toContain('could not be reached');
    expect(t).not.toContain('cannot keep a device key');
  });

  it('no device key storage (or no worker): the browser fault', async () => {
    fakeApi({});
    render(<DeviceCard load={() => Promise.reject(new ChatKeyError('unavailable'))} />);
    await settle();
    expect(part('device-fault')?.textContent).toContain('This browser cannot keep a device key.');
  });

  it('a device not yet confirmed: "Confirm this device" is not the page\'s primary action', async () => {
    fakeApi({ 'GET /staff/v1/devices': { body: { accountId: 'me', devices: [] } } });
    render(<DeviceCard load={async () => ({ deviceKeyId: 'a'.repeat(32), signPublic: 'b'.repeat(64), boxPublic: 'c'.repeat(64) })} />);
    await settle();
    expect(part('device-uncertified')).not.toBeNull();
    expect(button('Confirm this device')?.hasAttribute('data-primary')).toBe(false);
  });
});

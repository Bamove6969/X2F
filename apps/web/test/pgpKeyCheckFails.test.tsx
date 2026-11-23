// @vitest-environment happy-dom
// Security review of #144, item 3: the on-device key check debounces, and a check that throws
// shows the generic refusal (never "Key accepted", never a stuck "Add key").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { KEY_CHECK_DEBOUNCE_MS, KEY_CHECK_FAILED } from '../src/screens/setup/PgpKey.js';
import { AddPgpKey } from '../src/screens/settings/Methods.js';
import { fire, render } from './render.js';

const inspect = vi.hoisted(() => vi.fn());
vi.mock('@x2f/auth-client', async (orig) => ({ ...(await orig<typeof import('@x2f/auth-client')>()), inspectPublicKey: inspect }));

function paste(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
  fire(el, new Event('input', { bubbles: true }));
}
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('Settings, Add a PGP key: the check itself', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    inspect.mockReset();
  });
  afterEach(() => vi.useRealTimers());
  const mount = () => render(<AddPgpKey prove={async () => 'token'} onDone={() => undefined} onCancel={() => undefined} />);
  const addButton = (host: HTMLElement) => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add key')!;

  it('runs once, 250 ms after the last change, with the new-key rules', async () => {
    inspect.mockResolvedValue({ ok: false, reason: 'key-unreadable', detail: 'nope' });
    const { host } = mount();
    const box = host.querySelector('textarea')!;
    paste(box, 'a');
    await tick(100);
    paste(box, 'ab');
    await tick(KEY_CHECK_DEBOUNCE_MS - 1);
    expect(inspect).not.toHaveBeenCalled();
    await tick(1);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect.mock.calls[0]![0]).toBe('ab');
    expect(inspect.mock.calls[0]![2]).toEqual({ newKey: true });
  });

  it('a check that throws shows the generic refusal and keeps Add key off', async () => {
    inspect.mockRejectedValue(new Error('boom'));
    const { host } = mount();
    paste(host.querySelector('textarea')!, 'whatever');
    await tick(KEY_CHECK_DEBOUNCE_MS + 10);
    expect(host.querySelector('[data-part="key-refused"]')!.textContent).toBe(KEY_CHECK_FAILED);
    expect(addButton(host).disabled).toBe(true);
  });
});

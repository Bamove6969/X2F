// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError } from '@x2f/auth-client';
import { CONFIRM_CANCELLED } from '../src/screens/auth/ConfirmSheet.js';
import { authApi } from '../src/screens/auth/authApi.js';
import { RecoveryCodes } from '../src/screens/settings/RecoveryCodes.js';
import { fire, render } from './render.js';

function mount(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('RecoveryCodes screen component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders initial state with Show my recovery codes button', () => {
    const prove = vi.fn();
    const onDone = vi.fn();
    const { host } = mount(<RecoveryCodes prove={prove} onDone={onDone} />);

    const makeBtn = host.querySelector('[data-part="recovery-make"]');
    expect(makeBtn).not.toBeNull();
    expect(makeBtn?.textContent).toBe('Show my recovery code');
    expect((makeBtn as HTMLButtonElement).disabled).toBe(false);

    // No error or codes initially
    expect(host.querySelector('.x2f-error')).toBeNull();
    expect(host.querySelector('[data-part="code-list"]')).toBeNull();
  });

  it('generates and displays new recovery codes on click when applied', async () => {
    const prove = vi.fn().mockResolvedValue('confirm-token-123');
    const onDone = vi.fn();
    const fakeCodes = ['ABCD-1234', 'EFGH-5678', 'IJKL-9012'];

    vi.spyOn(authApi, 'newRecoveryCodes').mockResolvedValue({
      codes: fakeCodes,
    } as any);

    const { host } = mount(<RecoveryCodes prove={prove} onDone={onDone} />);
    const makeBtn = host.querySelector('[data-part="recovery-make"]')!;

    await act(async () => {
      fire(makeBtn, new MouseEvent('click', { bubbles: true }));
    });

    // Verification notice
    expect(host.querySelector('.x2f-note')?.textContent).toBe('Save this now. It works once, and you will not see it again.');

    // Codes list
    const list = host.querySelector('[data-part="code-list"]');
    expect(list).not.toBeNull();
    const items = [...host.querySelectorAll('[data-part="code-list"] li')].map((li) => li.textContent);
    expect(items).toEqual(fakeCodes);

    // Done button
    const doneBtn = host.querySelector('[data-part="recovery-done"]')!;
    expect(doneBtn.textContent).toBe('I have saved it');

    act(() => {
      fire(doneBtn, new MouseEvent('click', { bubbles: true }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('displays error message when generation fails', async () => {
    const prove = vi.fn().mockResolvedValue('confirm-token-123');
    const onDone = vi.fn();

    vi.spyOn(authApi, 'newRecoveryCodes').mockRejectedValue(new Error('Network failure'));

    const { host } = mount(<RecoveryCodes prove={prove} onDone={onDone} />);
    const makeBtn = host.querySelector('[data-part="recovery-make"]')!;

    await act(async () => {
      fire(makeBtn, new MouseEvent('click', { bubbles: true }));
    });

    const error = host.querySelector('.x2f-error[role="alert"]');
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain('Could not make your recovery code');

    // Make button is re-enabled
    expect((makeBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('swallows a cancelled confirm without displaying an error alert', async () => {
    // The API asks for a confirm; the person cancels the confirmation sheet.
    const run = vi
      .spyOn(authApi, 'newRecoveryCodes')
      .mockRejectedValue(new AuthApiError(403, 'confirm-required', { action: 'new-recovery-codes' }));
    const prove = vi.fn().mockRejectedValue(new Error(CONFIRM_CANCELLED));
    const onDone = vi.fn();

    const { host } = mount(<RecoveryCodes prove={prove} onDone={onDone} />);
    const makeBtn = host.querySelector('[data-part="recovery-make"]')!;

    await act(async () => {
      fire(makeBtn, new MouseEvent('click', { bubbles: true }));
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(prove).toHaveBeenCalledWith({ kind: 'new-recovery-codes' });
    expect(host.querySelector('.x2f-error')).toBeNull();
    expect(host.querySelector('[data-part="code-list"]')).toBeNull();
    expect((host.querySelector('[data-part="recovery-make"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

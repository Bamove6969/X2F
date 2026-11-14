// @vitest-environment happy-dom
// Signup round 3 (owner's demo notes, 13 Nov 2026): every password field has a show/hide button,
// hidden by default, with an accessible name.
import { describe, expect, it } from 'vitest';
import { PasswordInput } from '../src/ui/PasswordInput.js';
import { fire, render } from './render.js';

describe('PasswordInput', () => {
  it('is hidden by default; the eye shows it and hides it again, saying which in its label', () => {
    const { host } = render(<PasswordInput id="pw" value="Quiet-harbour-58" onChange={() => undefined} />);
    const input = host.querySelector<HTMLInputElement>('#pw')!;
    const eye = host.querySelector<HTMLButtonElement>('[data-part="password-eye"]')!;
    expect(input.type).toBe('password');
    expect(eye.type).toBe('button');
    expect(eye.getAttribute('aria-label')).toBe('Show password');
    expect(eye.getAttribute('aria-pressed')).toBe('false');
    expect(eye.getAttribute('aria-controls')).toBe('pw');
    fire(eye, new MouseEvent('click', { bubbles: true }));
    expect(input.type).toBe('text');
    expect(eye.getAttribute('aria-label')).toBe('Hide password');
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    fire(eye, new MouseEvent('click', { bubbles: true }));
    expect(input.type).toBe('password');
  });
});

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

  // Review of third-signup-r3 (16 Nov 2026), M4: a shown password is a text field, so spell-check,
  // autocorrect and auto-capitalise are off in both states (keyboards and spell-check services must
  // not learn or send it); autoComplete passes through unchanged.
  it('keeps spell-check, autocorrect and auto-capitalise off, shown or hidden, and cannot be turned back on by a prop', () => {
    const { host } = render(
      <PasswordInput id="pw2" value="Quiet-harbour-58" onChange={() => undefined} autoComplete="new-password" spellCheck autoCorrect="on" autoCapitalize="sentences" />,
    );
    const input = host.querySelector<HTMLInputElement>('#pw2')!;
    const eye = host.querySelector<HTMLButtonElement>('[data-part="password-eye"]')!;
    for (const shown of [false, true]) {
      if (shown) fire(eye, new MouseEvent('click', { bubbles: true }));
      expect(input.type).toBe(shown ? 'text' : 'password');
      expect(input.getAttribute('spellcheck')).toBe('false');
      expect(input.getAttribute('autocorrect')).toBe('off');
      expect(input.getAttribute('autocapitalize')).toBe('none');
      expect(input.getAttribute('autocomplete')).toBe('new-password');
    }
  });
});

/**
 * Signup round 3 (owner's demo notes, 13 Nov 2026: "no eyeball button ... Star them by default"):
 * a password field with a show/hide button. Hidden is the default; the button is 44 px, says what
 * it does in its accessible name, and reports its state with `aria-pressed`. Showing the password
 * changes only the input's type: the value is never copied anywhere else.
 */
import { useState, type InputHTMLAttributes } from 'react';
import { Icon } from './icons.js';

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string }) {
  const [shown, setShown] = useState(false);
  const { className, ...rest } = props;
  return (
    <span className="x2f-password" data-part="password-field">
      {/* Review of third-signup-r3 (16 Nov 2026), M4: shown, this is a text field, so spell-check
          services and mobile keyboards would read and learn the password. Off in both states, after
          the props so no caller can turn them back on; autoComplete passes through unchanged. */}
      <input
        {...rest}
        className={['x2f-input', 'x2f-password__input', className].filter(Boolean).join(' ')}
        type={shown ? 'text' : 'password'}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
      />
      <button
        type="button"
        className="x2f-password__eye"
        aria-controls={props.id}
        aria-pressed={shown}
        // COPY-UNSIGNED
        aria-label={shown ? 'Hide password' : 'Show password'}
        onClick={() => setShown((s) => !s)}
        data-part="password-eye"
      >
        <Icon name={shown ? 'eye-off' : 'eye'} size={22} />
      </button>
    </span>
  );
}

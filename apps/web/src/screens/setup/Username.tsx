/**
 * Setup step 1 (board SetupUsername; spec 6.1, owner 2026-10-23): the public username (the spec's
 * "display name": offers, profiles, chat), shown exactly as typed, and the private login name, never
 * shown to anyone. Both 5-20 letters, numbers, dots, dashes and underscores; they must differ.
 */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { Icon } from '../../ui/icons.js';
import { checkDisplayName, checkNames, namesProblem } from './names.js';

export function Username() {
  const { state, update, go, path } = useSetup();
  const [displayName, setDisplayName] = useState(state.displayName);
  const [loginName, setLoginName] = useState(state.loginName);
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    const r = checkNames(displayName, loginName);
    if (!r.ok) {
      setError(namesProblem(r));
      return;
    }
    update({ displayName: r.display.name, loginName: r.login.name, challenge: null });
    go('login');
  };

  return (
    <SetupFrame
      screen="setup-name"
      step={1}
      back={path('')}
      footer={
        <Button variant="primary" onClick={next} data-part="names-continue">
          Continue
        </Button>
      }
    >
      <SetupIntro title="Pick a username">This is how traders see you. No email or phone number needed, now or ever.</SetupIntro>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="uname">
          Username
        </label>
        <input
          className="x2f-input x2f-setup__name"
          id="uname"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        {checkDisplayName(displayName).ok ? (
          <span className="x2f-setup__status x2f-setup__preview" data-tone="escrow" data-part="name-preview">
            <Icon name="check" size={18} stroke={2} />
            <span>
              Traders will see <span data-username="">{displayName}</span>
            </span>
          </span>
        ) : null}
        <p className="x2f-setup__help">
          5 to 20 characters: letters, numbers, dots, dashes and underscores. It shows exactly as you type it. Pick something that isn't your real
          name or used elsewhere.
        </p>
      </div>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="login-name">
          Login name
        </label>
        <input
          className="x2f-input x2f-setup__name"
          id="login-name"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          value={loginName}
          onChange={(e) => setLoginName(e.target.value)}
        />
        <p className="x2f-setup__help">
          Private: nobody else ever sees it. You use it to log in with a password or a security key, so make it different from your username.
        </p>
      </div>
      {error !== null ? (
        <p className="x2f-error" role="alert" data-part="names-error">
          {error}
        </p>
      ) : null}
    </SetupFrame>
  );
}

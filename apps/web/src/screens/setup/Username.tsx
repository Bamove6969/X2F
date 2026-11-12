/**
 * Setup step 1 (board SetupUsername; design real-app review item 6; owner Q54: "Your username is
 * never shown to anybody and is as confidential as your password"): ONE field, the private
 * username, which is the login name. A live tick says whether it is free (availability.ts; the
 * server paces it). The public display name follows on its own screen (DisplayName.tsx; owner G6:
 * "a unique username and also a unique display name"). 5-20 letters, numbers, dots, dashes and
 * underscores.
 */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { availabilityLine, useNameAvailability, type NameChecker } from './availability.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { checkLoginName, nameShapeProblem } from './names.js';

export function Username({ check }: { check?: NameChecker } = {}) {
  const { state, update, go, path } = useSetup();
  const [loginName, setLoginName] = useState(state.loginName);
  const [error, setError] = useState<string | null>(null);
  const availability = useNameAvailability(loginName, check);
  const line = availabilityLine(availability);

  const next = () => {
    const r = checkLoginName(loginName);
    if (!r.ok) {
      // A login name has no reserved words (only a display name does), so any refusal is its shape.
      setError(nameShapeProblem('Your username', r.reason === 'length' ? 'length' : 'characters'));
      return;
    }
    if (availability.state === 'taken') {
      setError('That username is taken. Pick another.');
      return;
    }
    update({ loginName: r.name, challenge: null });
    go('display-name');
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
      {/* COPY-UNSIGNED (owner, 12 Nov 2026: the heading is his words; the lead no longer says there is
          nothing else to give, since the next screens ask for a login method and a payout wallet) */}
      <SetupIntro title="Pick a unique username">
        You type this to log in. Only you see it. Nobody can work it out from your display name. X2F never asks for your email address or phone
        number.
      </SetupIntro>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="uname">
          Username
        </label>
        <input
          className="x2f-input x2f-start__name"
          id="uname"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          aria-describedby="uname-status uname-help"
          value={loginName}
          onChange={(e) => {
            setLoginName(e.target.value);
            setError(null);
          }}
        />
        <span id="uname-status" aria-live="polite">
          {line !== null ? (
            <span className="x2f-start__status" data-tone={line.tone} data-part="name-status">
              {line.tone === 'escrow' ? <Icon name="check" size={18} stroke={2} /> : null}
              <span>{line.text}</span>
            </span>
          ) : null}
        </span>
        <p className="x2f-start__help" id="uname-help">
          5 to 20 characters: letters, numbers, dots, dashes and underscores. Pick something that isn't your real name or used elsewhere.
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

/**
 * Setup step 1, second screen (owner G6 and G14: every account has "a unique username and also a
 * unique display name"; design gaps SignupSecurity's "Your names" card): the public display name,
 * shown to traders exactly as typed. It must differ from the private username picked just before.
 * A taken display name is found when the account is made (409 `display-name-taken`, before any
 * hashing), with a link back here.
 */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { DISPLAY_SYMBOLS, checkDisplayName, checkNames, namesProblem } from './names.js';

export function DisplayName() {
  const { state, update, go, path } = useSetup();
  const [displayName, setDisplayName] = useState(state.displayName);
  const [error, setError] = useState<string | null>(null);
  const check = checkDisplayName(displayName);
  const shown = check.ok ? check.name : null;

  const next = () => {
    const r = checkNames(displayName, state.loginName);
    if (!r.ok) {
      setError(namesProblem(r));
      return;
    }
    update({ displayName: r.display.name, challenge: null });
    go('login');
  };

  return (
    <SetupFrame
      screen="setup-display-name"
      step={1}
      back={path('name')}
      footer={
        <Button variant="primary" onClick={next} data-part="display-continue">
          Continue
        </Button>
      }
    >
      <SetupIntro title="Pick a display name">This is how traders see you. It must be different from your username.</SetupIntro>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor="display-name">
          Display name
        </label>
        <input
          className="x2f-input x2f-start__name"
          id="display-name"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          aria-describedby="display-name-help"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setError(null);
          }}
        />
        {shown !== null ? (
          <span className="x2f-start__status x2f-start__preview" data-tone="escrow" data-part="name-preview">
            <Icon name="check" size={18} stroke={2} />
            <span>
              Traders will see <span data-username="">{shown}</span>
            </span>
          </span>
        ) : null}
        <p className="x2f-start__help" id="display-name-help">
          {/* COPY-UNSIGNED (signup round 3: the display name's wider set) */}
          5 to 20 characters: letters, numbers, spaces and {DISPLAY_SYMBOLS} Extra spaces are removed.
        </p>
      </div>
      {error !== null ? (
        <p className="x2f-error" role="alert" data-part="display-error">
          {error}
        </p>
      ) : null}
    </SetupFrame>
  );
}

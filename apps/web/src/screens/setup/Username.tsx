/**
 * Setup step 1 (board SetupUsername; design real-app review item 6; owner Q54: "Your username is
 * never shown to anybody and is as confidential as your password"): ONE field, the private
 * username, which is the login name. A live tick says whether it is free (availability.ts; the
 * server paces it). The public display name follows on its own screen (DisplayName.tsx; owner G6:
 * "a unique username and also a unique display name"). 8-20 letters, numbers, dots, dashes and
 * underscores (owner demo note #126, 23 Nov 2026: "minimum of 8 characters").
 *
 * Owner demo notes #196 and #197 (25 Nov 2026, the advice he pasted): Continue stays disabled until
 * the name passes `checkNewLoginName` and is not known to be taken; the rules are a live checklist
 * that ticks as the person types (muted until met, red only once something typed breaks one); a
 * "Generate random" text button fills a random valid name (randomName.ts); the field's label is
 * "Private login ID" in the strong setup label style, with an example placeholder.
 */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
// The visually hidden rule states (x2f-sr-only).
import '../../ui/kit.css';
import { availabilityLine, useNameAvailability, type NameChecker } from './availability.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { checkNewLoginName, hasSpace, nameShapeProblem, spaceProblem, usernameRules, type UsernameRuleState } from './names.js';
import { randomLoginName } from './randomName.js';

function Rule({ id, met, children }: { id: string; met: UsernameRuleState; children: string }) {
  return (
    <li className="x2f-start__rule" data-rule={id} data-met={met}>
      <Icon name={met === 'false' ? 'close' : 'check'} size={18} stroke={2} />
      {children}
      {/* COPY-UNSIGNED (owner demo note #196: each rule's state said in words for screen readers) */}
      <span className="x2f-sr-only">{met === 'true' ? ', met' : met === 'false' ? ', not met' : ', not yet'}</span>
    </li>
  );
}

export function Username({ check }: { check?: NameChecker } = {}) {
  const { state, update, go, path } = useSetup();
  const [loginName, setLoginName] = useState(state.loginName);
  const [error, setError] = useState<string | null>(null);
  const availability = useNameAvailability(loginName, check);
  const line = availabilityLine(availability);
  // Owner demo note #108: a space is named as soon as it is typed, not only on Continue.
  const spaced = hasSpace(loginName);
  const rules = usernameRules(loginName);
  // Owner demo note #196: Continue is disabled until the name is valid and not known to be taken.
  const canContinue = checkNewLoginName(loginName).ok && availability.state !== 'taken';

  const next = () => {
    const r = checkNewLoginName(loginName);
    if (spaced) {
      // The step calls it the Login ID (owner demo notes #197 and #199).
      setError(spaceProblem('username', 'Login ID'));
      return;
    }
    if (!r.ok) {
      // A login name has no reserved words (only a display name does), so any refusal is its shape.
      setError(nameShapeProblem('Your Login ID', r.reason === 'length' ? 'length' : 'characters'));
      return;
    }
    if (availability.state === 'taken') {
      // COPY-UNSIGNED (owner demo notes #197 and #199: "Login ID" on the sign-up)
      setError('That Login ID is taken. Pick another.');
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
        <Button variant="primary" onClick={next} disabled={!canContinue} data-part="names-continue">
          Continue
        </Button>
      }
    >
      {/* COPY-UNSIGNED (owner, 12 Nov 2026: the heading is his words; the lead no longer says there is
          nothing else to give, since the next screens ask for a login method and a payout wallet) */}
      {/* Owner demo note #193 (25 Nov): the heading in his words. COPY-UNSIGNED. */}
      <SetupIntro title="Create your private login ID">
        {/* Owner demo note #195 (25 Nov): the whole lead in his words, replacing #124's. */}
        {/* not-a-refusal: "cannot be traced back" reassures about privacy; nothing was tried and refused */}
        You'll use this private username to sign in—nobody else will ever see it. In the next step, you'll choose a separate public
        display name that other traders see. Your display name cannot be traced back to your login username, and X2F never asks for an
        email address or phone number.
      </SetupIntro>
      <div className="x2f-field">
        {/* Owner demo note #197 (25 Nov): "Private login ID", sentence case, the strong field label. COPY-UNSIGNED. */}
        <label className="x2f-label x2f-start__field-label" htmlFor="uname">
          Private login ID
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
          // COPY-UNSIGNED (owner demo note #197: an example inside the field)
          placeholder="e.g. midnight_otter_42"
          aria-describedby={spaced ? 'uname-space uname-status uname-rules uname-help' : 'uname-status uname-rules uname-help'}
          aria-invalid={spaced ? true : undefined}
          value={loginName}
          onChange={(e) => {
            setLoginName(e.target.value);
            setError(null);
          }}
        />
        <button
          type="button"
          // The tap-sized text button: a 44 px target on a phone (expectPhoneLayout).
          className="x2f-start__textbutton x2f-start__textbutton--tap"
          data-part="name-generate"
          onClick={() => {
            setLoginName(randomLoginName());
            setError(null);
          }}
        >
          {/* COPY-UNSIGNED (owner demo note #196: the advice's "Generate random" button) */}
          Generate random
        </button>
        <span id="uname-status" aria-live="polite">
          {line !== null ? (
            <span className="x2f-start__status" data-tone={line.tone} data-part="name-status">
              {line.tone === 'escrow' ? <Icon name="check" size={18} stroke={2} /> : null}
              <span>{line.text}</span>
            </span>
          ) : null}
        </span>
        {spaced && error === null ? (
          <p className="x2f-error" id="uname-space" data-part="name-space">
            {spaceProblem('username', 'Login ID')}
          </p>
        ) : null}
        {/* Owner demo note #196: the rules tick as the person types (they were one grey sentence). COPY-UNSIGNED. */}
        <ul className="x2f-start__rules" id="uname-rules" aria-label="Login ID rules" data-part="name-rules">
          <Rule id="length" met={rules.length}>
            8–20 characters
          </Rule>
          <Rule id="characters" met={rules.characters}>
            Letters, numbers, dots, dashes and underscores only
          </Rule>
          {/* Owner demo note #108: no spaces. */}
          <Rule id="no-spaces" met={rules.noSpaces}>
            No spaces
          </Rule>
        </ul>
        {/* COPY-UNSIGNED (the board's advice, kept as plain help by owner demo note #196) */}
        <p className="x2f-start__help" id="uname-help">
          Pick something that isn't your real name or used elsewhere.
        </p>
      </div>
      {/* Kept as a safety net: Continue is disabled whenever one of these would show (note #196). */}
      {error !== null ? (
        <p className="x2f-error" role="alert" data-part="names-error">
          {error}
        </p>
      ) : null}
    </SetupFrame>
  );
}

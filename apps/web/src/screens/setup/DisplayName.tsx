/**
 * Setup step 2 (owner demo note #199, 25 Nov 2026: it was "Step 1 of 5", the same as the username; owner G6 and G14: every account has "a unique username and also a
 * unique display name"; design gaps SignupSecurity's "Your names" card): the public display name,
 * shown to traders exactly as typed. It must differ from the private username picked just before.
 * A taken display name is found when the account is made (409 `display-name-taken`, before any
 * hashing), with a link back here.
 *
 * Owner demo notes #199 and #200 (25 Nov 2026): a live trader card preview under the field (the
 * offer card's pieces for a brand-new member: the avatar, the amber New badge, "0 trades" and the
 * profile's "No ratings yet"), 2-3 suggestion chips with a refresh chip (randomName.ts), the note
 * that a display name is permanent (no API route changes it), and Continue straight under the
 * card rather than pinned to the bottom (SetupFrame `footerInline`), in thumb reach above a phone
 * keyboard.
 *
 * Owner demo note #219 (25 Nov 2026): Continue is disabled (the dimmed primary) until the name
 * passes `checkNames` (the display-name rules, and not the Login ID). What is wrong is said under
 * the field as quiet help once the person has typed: a reserved word or the Login ID at once, a
 * wrong length or character once they leave the field. A taken name is still only the server's to
 * know (409 at register, RegisterError links back here).
 */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Avatar } from '../../ui/Avatar.js';
import { BadgePill } from '../../ui/BadgePill.js';
import { NEW_BADGE, tradesWord } from '../browse/posterCopy.js';
import { PROFILE_COPY } from '../profile/profileCopy.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { DISPLAY_SYMBOLS, checkNames, checkNewDisplayName, hasSpace, namesProblem, spaceProblem } from './names.js';
import { suggestDisplayNames } from './randomName.js';

/** How many suggestion chips the step shows (owner demo note #200: "2-3"). */
export const SUGGESTIONS = 3;

/**
 * The trader card preview (owner demo note #199): the name as typed, on the offer card's pieces for
 * a member with no trades yet. A new member is not Graduated, so the offer card leads with the New
 * badge (OfferCard.tsx NEW_BADGE), says "0 trades" and no % positive until a rated review; the
 * profile says "No ratings yet" (profileCopy.ts noPct). Nothing here is the member's real record.
 */
function TraderPreview({ name }: { name: string }) {
  // `name` is '' until what is typed passes checkNewDisplayName.
  const empty = name === '';
  // COPY-UNSIGNED (owner demo note #199: a neutral name while the field is empty)
  const shown = empty ? 'Your display name' : name;
  return (
    <section className="x2f-card x2f-start__preview-card" aria-labelledby="display-preview-h" data-part="trader-preview">
      {/* COPY-UNSIGNED (owner demo note #199: "Trader Card Preview", in sentence case) */}
      <h2 className="x2f-start__preview-h" id="display-preview-h">
        Trader card preview
      </h2>
      <span className="x2f-start__preview-who">
        <Avatar name={shown} size={48} {...(empty ? { initials: '?' } : {})} />
        <span className="x2f-start__preview-text">
          <span className="x2f-start__preview-name-row">
            <span className="x2f-start__preview-name" data-username="" data-placeholder={empty ? 'true' : undefined} data-part="preview-name">
              {shown}
            </span>
            <BadgePill tone={NEW_BADGE.tone} icon={NEW_BADGE.icon} label={NEW_BADGE.label} />
          </span>
          <span className="x2f-start__preview-meta" data-part="preview-stats">
            <span className="x2f-digits">0</span> {tradesWord(0)} · {PROFILE_COPY.noPct}
          </span>
        </span>
      </span>
    </section>
  );
}

export function DisplayName() {
  const { state, update, go, path } = useSetup();
  const [displayName, setDisplayName] = useState(state.displayName);
  // Owner demo note #219: the field has been left once, so a length or character problem may be said.
  const [left, setLeft] = useState(false);
  // Owner demo note #108: no spaces in a new display name.
  const spaced = hasSpace(displayName.trim());
  const valid = checkNewDisplayName(displayName);
  const previewName = valid.ok ? valid.name : '';
  const [suggestions, setSuggestions] = useState(() => suggestDisplayNames(SUGGESTIONS, state.loginName));

  // Owner demo note #219: Continue is disabled until the names pass; the click is a no-op otherwise.
  const names = checkNames(displayName, state.loginName);
  const problem =
    names.ok || spaced || displayName.trim() === '' || !(left || names.reason === 'reserved' || names.reason === 'same') ? null : namesProblem(names);
  const describedBy = [spaced ? 'display-name-space' : '', problem !== null ? 'display-name-problem' : '', 'display-name-help'].filter((id) => id !== '');

  const next = () => {
    const r = names;
    if (!r.ok) return;
    update({ displayName: r.display.name, challenge: null });
    go('login');
  };

  return (
    <SetupFrame
      screen="setup-display-name"
      // Owner demo note #199 (25 Nov): the second screen is step 2 of 5 (the login methods are step 3).
      step={2}
      back={path('name')}
      // Owner demo note #199: Continue sits under the card, not pinned to the bottom of the screen.
      footerInline
      footer={
        <Button variant="primary" onClick={next} disabled={!names.ok} data-part="display-continue">
          Continue
        </Button>
      }
    >
      {/* Owner demo note #199 (25 Nov): "It must be different from your Login ID". COPY-UNSIGNED. */}
      <SetupIntro title="Pick a display name">This is how traders see you. It must be different from your Login ID.</SetupIntro>
      <div className="x2f-field">
        {/* Owner demo note #197: the same strong field label as the private login ID. */}
        <label className="x2f-label x2f-start__field-label" htmlFor="display-name">
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
          aria-describedby={describedBy.join(' ')}
          aria-invalid={spaced || problem !== null ? true : undefined}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={() => setLeft(true)}
        />
        {spaced ? (
          <p className="x2f-error" id="display-name-space" data-part="display-space">
            {spaceProblem('display name')}
          </p>
        ) : null}
        {/* Owner demo note #219: why Continue is still dimmed, once there is something to say (namesProblem's sentences). */}
        <div aria-live="polite">
          {problem !== null ? (
            <p className="x2f-start__help" id="display-name-problem" data-part="display-problem">
              {problem}
            </p>
          ) : null}
        </div>
        <p className="x2f-start__help" id="display-name-help">
          {/* COPY-UNSIGNED (signup round 3: the display name's wider set; owner demo note #108: no spaces; #127: 8 to 20) */}
          8 to 20 characters: letters, numbers and common symbols such as {DISPLAY_SYMBOLS}, with no spaces.
        </p>
        {/* Owner demo note #200: tappable suggestions and a refresh chip; a tap fills the box. */}
        <div className="x2f-start__chips" role="group" aria-label="Suggested display names" data-part="display-suggestions">
          {suggestions.map((n) => (
            <button
              key={n}
              type="button"
              className="x2f-start__chip"
              data-part="display-suggestion"
              onClick={() => setDisplayName(n)}
            >
              <span data-username="">{n}</span>
            </button>
          ))}
          <button
            type="button"
            className="x2f-start__chip"
            data-part="display-suggestions-refresh"
            // COPY-UNSIGNED (owner demo note #200: the refresh chip)
            aria-label="More suggestions"
            onClick={() => setSuggestions(suggestDisplayNames(SUGGESTIONS, state.loginName))}
          >
            <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>
      {/* The typed name only while it passes the display-name rules; else the neutral one (review). */}
      <TraderPreview name={previewName} />
      {/* COPY-UNSIGNED: owner demo note #199, his sentence (verified 25 Nov 2026: no API route changes a display name). */}
      <p className="x2f-start__warn" data-part="display-permanent">
        Your display name is permanent—pick a handle you'll be happy building your trading reputation under.
      </p>
    </SetupFrame>
  );
}

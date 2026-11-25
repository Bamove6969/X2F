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
 */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Avatar } from '../../ui/Avatar.js';
import { BadgePill } from '../../ui/BadgePill.js';
import { PROFILE_COPY } from '../profile/profileCopy.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { DISPLAY_SYMBOLS, checkNames, hasSpace, namesProblem, spaceProblem } from './names.js';
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
            <BadgePill tone="caution" icon="sprout" label="New" />
          </span>
          <span className="x2f-start__preview-meta" data-part="preview-stats">
            <span className="x2f-digits">0</span> trades · {PROFILE_COPY.noPct}
          </span>
        </span>
      </span>
    </section>
  );
}

export function DisplayName() {
  const { state, update, go, path } = useSetup();
  const [displayName, setDisplayName] = useState(state.displayName);
  const [error, setError] = useState<string | null>(null);
  // Owner demo note #108: no spaces in a new display name.
  const spaced = hasSpace(displayName.trim());
  const [suggestions, setSuggestions] = useState(() => suggestDisplayNames(SUGGESTIONS, state.loginName));

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
      // Owner demo note #199 (25 Nov): the second screen is step 2 of 5 (the login methods are step 3).
      step={2}
      back={path('name')}
      // Owner demo note #199: Continue sits under the card, not pinned to the bottom of the screen.
      footerInline
      footer={
        <Button variant="primary" onClick={next} data-part="display-continue">
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
          aria-describedby={spaced ? 'display-name-space display-name-help' : 'display-name-help'}
          aria-invalid={spaced ? true : undefined}
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            setError(null);
          }}
        />
        {spaced && error === null ? (
          <p className="x2f-error" id="display-name-space" data-part="display-space">
            {spaceProblem('display name')}
          </p>
        ) : null}
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
              onClick={() => {
                setDisplayName(n);
                setError(null);
              }}
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
      <TraderPreview name={displayName.trim()} />
      {/* COPY-UNSIGNED: owner demo note #199, his sentence (verified 25 Nov 2026: no API route changes a display name). */}
      <p className="x2f-start__warn" data-part="display-permanent">
        Your display name is permanent—pick a handle you'll be happy building your trading reputation under.
      </p>
      {error !== null ? (
        <p className="x2f-error" role="alert" data-part="display-error">
          {error}
        </p>
      ) : null}
    </SetupFrame>
  );
}

/**
 * Setup step 2 (owner demo note #199, 25 Nov 2026: it was "Step 1 of 5", the same as the username; owner G6 and G14: every account has "a unique username and also a
 * unique display name"; design gaps SignupSecurity's "Your names" card): the public display name,
 * shown to traders exactly as typed. It must differ from the private username picked just before.
 * A taken display name is found when the account is made (409 `display-name-taken`, before any
 * hashing), with a link back here.
 *
 * Owner demo notes #199 and #200 (25 Nov 2026): a live trader card preview under the field (since
 * note #220, an established trader's example card with the name as typed: `TraderPreview`), 2-3 suggestion chips with a refresh chip (randomName.ts), the note
 * that a display name is permanent (no API route changes it), and Continue straight under the
 * card rather than pinned to the bottom (SetupFrame `footerInline`), in thumb reach above a phone
 * keyboard.
 */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { BADGE_SET, BadgeSeal } from '../../ui/Badges.js';
import { IdentityRow, StatTiles, traderStats } from '../../ui/Identity.js';
import { PROFILE_COPY } from '../profile/profileCopy.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { DISPLAY_SYMBOLS, checkNames, checkNewDisplayName, hasSpace, namesProblem, spaceProblem } from './names.js';
import { suggestDisplayNames } from './randomName.js';

/** How many suggestion chips the step shows (owner demo note #200: "2-3"). */
export const SUGGESTIONS = 3;

/**
 * The example trader card (owner demo note #220, 25 Nov 2026: "a mockup of a trader card if they had
 * been using the site for a while ... badges on it ... an avatar on it ... just with the display
 * name displayed exactly how they have it entered"). Every piece is the app's own, filled with an
 * established trader's example record, and the card says it is an example:
 * - the kit's identity row (ui/Identity.tsx IdentityRow: the Avatar with the Trusted ring and the
 *   online dot, the name, the Vendor tag) with the profile's "member since" (profileCopy.ts);
 * - the kit's stat tiles with its trader stats (traderStats: trades, % positive, XMR traded);
 * - badge seals of real badges (ui/Badges.tsx BADGE_SET), each with its name; the record below
 *   earns every one (Trusted: 200+ trades and 98%+; Veteran: over a year; 100 trades);
 * - the profile's lines: typical payment time, "Disputes: none", "Account protected with PGP".
 * The name is the one typed while it passes checkNewDisplayName, else the example name.
 */
export const EXAMPLE_TRADER = {
  // COPY-UNSIGNED (owner demo note #220: the example name while the field is empty or invalid;
  // the boards' own example trader)
  name: 'nightowl_44',
  memberSince: '2024-09',
  trades: 248,
  positivePct: 99,
  xmrTraded: '86.4',
  typicalMinutes: 6,
  badges: [BADGE_SET.trusted, BADGE_SET.veteran, BADGE_SET.fast, BADGE_SET.clean, BADGE_SET.m100, BADGE_SET.pgp],
} as const;

function TraderPreview({ name }: { name: string }) {
  // `name` is '' until what is typed passes checkNewDisplayName.
  const example = name === '';
  const shown = example ? EXAMPLE_TRADER.name : name;
  const t = EXAMPLE_TRADER;
  return (
    <section
      className="x2f-start__showcase"
      aria-labelledby="display-preview-h"
      data-part="trader-preview"
      data-example-name={example ? 'true' : undefined}
    >
      <div className="x2f-start__showcase-top">
        {/* COPY-UNSIGNED (owner demo note #220: the card is an example, not their record) */}
        <h2 className="x2f-start__showcase-h" id="display-preview-h">
          What your trader card could look like
        </h2>
        <span className="x2f-start__showcase-tag" data-part="preview-example">
          Example
        </span>
      </div>
      <IdentityRow
        person={{ name: shown, trusted: true, online: true, vendor: true, meta: PROFILE_COPY.presence(true, t.memberSince).replace(/^Online · /, '') }}
        size={48}
      />
      {/* COPY-UNSIGNED (owner demo note #220): the stats are labelled as an example, for screen readers too. */}
      <div className="x2f-start__showcase-stats" role="group" aria-label="Example stats" data-part="preview-stats">
        <StatTiles items={traderStats({ trades: t.trades, positivePct: t.positivePct, xmrTraded: t.xmrTraded })} />
      </div>
      <ul className="x2f-start__showcase-badges" aria-label="Example badges" data-part="preview-badges">
        {t.badges.map((b) => (
          <li key={b.key} className="x2f-start__showcase-badge">
            <BadgeSeal badge={b} size={28} />
            <span>{b.name}</span>
          </li>
        ))}
      </ul>
      <ul className="x2f-start__showcase-facts" data-part="preview-facts">
        <li>
          <span className="x2f-digits">{PROFILE_COPY.typicalValue(t.typicalMinutes)}</span> {PROFILE_COPY.typical}
        </li>
        <li>{PROFILE_COPY.disputes({ won: 0, lost: 0 })}</li>
        <li>{PROFILE_COPY.pgp}</li>
      </ul>
    </section>
  );
}

export function DisplayName() {
  const { state, update, go, path } = useSetup();
  const [displayName, setDisplayName] = useState(state.displayName);
  const [error, setError] = useState<string | null>(null);
  // Owner demo note #108: no spaces in a new display name.
  const spaced = hasSpace(displayName.trim());
  const valid = checkNewDisplayName(displayName);
  const previewName = valid.ok ? valid.name : '';
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
      {/* The typed name only while it passes the display-name rules; else the neutral one (review). */}
      <TraderPreview name={previewName} />
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

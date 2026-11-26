/**
 * Job 1c (J-10; spec 6.7; owner S-087, S-092, S-094, S-097): the permission boxes, for an invite
 * and for a member's edit. Drawn from the API's own catalogue (`GET /v1/team/permissions`), never a
 * copy: its groups (each a Disclosure with how many boxes are ticked), its presets as buttons that
 * fill the boxes, and each box with what it lets the member do.
 *
 * A box the catalogue marks `not-built`, `waits-member-keys` or `waits-member-chat-key` can be
 * ticked like any other and says "Coming later" (the API stores it; it does nothing until the
 * feature is built). The owner's alone ones say "Only you" and the always-on ones "Every member
 * has this": those two cannot be ticked, and `sendable` drops them from what is sent.
 *
 * No Claude Design board yet (NEEDS_DESIGN_TEAM): kit parts and existing classes only, no inline
 * styles. COPY-UNSIGNED: every word here is in teamCopy.ts (PICKER_COPY) or the catalogue's own.
 */
import { Button } from '../../ui/Button.js';
import { Disclosure } from '../../ui/Disclosure.js';
import { PICKER_COPY as P } from './teamCopy.js';
import { boxKind, isTickable, presetMatching, presetBoxes, sendable, type Catalogue } from './teamApi.js';

/**
 * Owner question trades-release (26 Nov 2026): Release coins needs Hold trade keys (the API's
 * ABILITY_REQUIRES; it refuses one without the other, 400 release-needs-trade-keys). Ticking one
 * never ticks the other for the lead: the box says so, and the save is refused until both or neither.
 */
const RELEASE_BOX = 'trades-release';
const RELEASE_NEEDS = 'trades-escrow-keys';

export function AbilityPicker({ catalogue, value, onChange, idPrefix }: { catalogue: Catalogue; value: readonly string[]; onChange: (next: string[]) => void; idPrefix: string }) {
  const picked = sendable(catalogue, value);
  const has = new Set(picked);
  const preset = presetMatching(catalogue, picked);
  const toggle = (id: string, on: boolean) => onChange(sendable(catalogue, on ? [...picked, id] : picked.filter((x) => x !== id)));
  return (
    <fieldset className="x2f-field x2f-stack" data-part="abilities">
      <legend className="x2f-label">{P.title}</legend>
      <p className="x2f-note" data-part="abilities-summary">
        {P.summary(picked.length, preset?.label ?? null)}
      </p>
      <div className="x2f-row" role="group" aria-label={P.presetsLabel} data-part="presets">
        {catalogue.presets.map((p) => (
          <Button key={p.id} variant="secondary" aria-pressed={preset?.id === p.id} onClick={() => onChange(presetBoxes(catalogue, p.id))} data-preset={p.id} title={p.note}>
            {p.label}
          </Button>
        ))}
      </div>
      {catalogue.groups.map((g) => {
        const tickable = g.abilities.filter(isTickable);
        const on = tickable.filter((a) => has.has(a.id)).length;
        return (
          <Disclosure key={g.id} summary={g.label} {...(tickable.length > 0 ? { note: P.groupTicked(on, tickable.length) } : {})} part={`group-${g.id}`}>
            {(id) => (
              <ul className="x2f-list" id={id} data-group={g.id}>
                {g.abilities.map((a) => {
                  const kind = boxKind(a);
                  const locked = kind === 'yours' || kind === 'always';
                  const inputId = `${idPrefix}-${a.id}`;
                  return (
                    <li className="x2f-list__row" key={a.id} data-ability={a.id} data-availability={a.availability} aria-disabled={locked ? true : undefined}>
                      <label className="x2f-row x2f-team__role" htmlFor={inputId}>
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={kind === 'always' || (!locked && has.has(a.id))}
                          disabled={locked}
                          aria-describedby={`${inputId}-does`}
                          onChange={(e) => toggle(a.id, e.target.checked)}
                          data-box={a.id}
                        />
                        <span className="x2f-list__label">
                          {a.label}
                          <br />
                          <span className="x2f-list__time" id={`${inputId}-does`}>
                            {kind === 'now' ? a.does : `${a.does} · ${P.reason[kind]}`}
                          </span>
                        </span>
                      </label>
                      {a.id === RELEASE_BOX && has.has(RELEASE_BOX) && !has.has(RELEASE_NEEDS) ? (
                        <p className="x2f-note" data-part="release-needs-keys">
                          {P.releaseNeedsKeys}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Disclosure>
        );
      })}
    </fieldset>
  );
}

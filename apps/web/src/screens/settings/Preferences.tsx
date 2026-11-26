/**
 * Settings → Preferences (owner-chosen scope, 26 Nov 2026): choices kept on this device only
 * (prefs.ts), for the account owner and team members alike, with no API call. Start on (the side
 * `/` opens on), Preferred currency (Browse's pick when the address names none), and a read-only
 * line on the clock: every time shows in UTC on every device (ui/dates.ts), so screenshots match;
 * that rule is not a preference here. DESIGNER-REVIEW: no board yet.
 */
import { useId, useState } from 'react';
import { ChoiceGroup } from '../../ui/Choice.js';
import { CURRENCIES } from '../browse/api.js';
import { readPrefs, writePrefs, type Prefs, type StartSide } from './prefs.js';
import { PREFERENCES_COPY as C } from './settingsCopy.js';
import { SettingsPage } from './SettingsTabs.js';

const SIDES: readonly StartSide[] = ['sell', 'buy'];

export function PreferencesCard() {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs());
  const [saved, setSaved] = useState(false);
  const sideId = useId();
  const currencyId = useId();
  const save = (change: Prefs) => {
    setPrefs(writePrefs(change));
    setSaved(true);
  };
  const currency = prefs.currency !== undefined && (CURRENCIES as readonly string[]).includes(prefs.currency) ? prefs.currency : 'USD';
  return (
    <>
      <section className="x2f-card" data-part="preferences" aria-labelledby="settings-preferences-h">
        <h2 className="x2f-card__title" id="settings-preferences-h">
          {C.cardTitle}
        </h2>
        <p className="x2f-fine">{C.intro}</p>
        <div className="x2f-field" data-part="pref-side">
          <span className="x2f-label" id={sideId}>
            {C.sideLabel}
          </span>
          <ChoiceGroup
            look="card"
            labelledBy={sideId}
            part="pref-side-option"
            options={SIDES.map((s) => ({ value: s, label: C.side[s] }))}
            value={prefs.startSide ?? 'sell'}
            onChange={(s) => save({ startSide: s })}
          />
          <p className="x2f-fine">{C.sideHint}</p>
        </div>
        <div className="x2f-field" data-part="pref-currency">
          <label className="x2f-label" htmlFor={currencyId}>
            {C.currencyLabel}
          </label>
          <select className="x2f-select" id={currencyId} value={currency} onChange={(e) => save({ currency: e.target.value })} data-part="pref-currency-select">
            {CURRENCIES.map((c) => (
              <option value={c} key={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="x2f-fine">{C.currencyHint}</p>
        </div>
        {saved ? (
          <p className="x2f-fine" role="status" data-part="pref-saved">
            {C.saved}
          </p>
        ) : null}
      </section>
      <section className="x2f-card" data-part="pref-clock" aria-labelledby="settings-clock-h">
        <h2 className="x2f-card__title" id="settings-clock-h">
          {C.clockTitle}
        </h2>
        <p className="x2f-fine">{C.clock}</p>
      </section>
    </>
  );
}

/** The Preferences tab: the same for the account owner and a team member (nothing here is the owner's alone). */
export function PreferencesSettings() {
  return (
    <SettingsPage tab="preferences" screen="settings-preferences">
      <PreferencesCard />
    </SettingsPage>
  );
}

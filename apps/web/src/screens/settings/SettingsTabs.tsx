/**
 * Settings, split into tabs (owner demo note #101, 16 Nov 2026). Each tab is its own route, so a
 * tab can be linked to, kept in the address and opened in a new browser tab:
 * - Security (/settings/security): login methods, the recovery code, account changes, the payout
 *   wait, and the way on to Devices and sessions and the idle reminder.
 * - Alerts (/settings/alerts): the alarm sound, Jabber notices and the alerts list.
 * - Account (/settings/account): account type, team and blocked traders.
 * - Help (/settings/help): the guided tour and the welcome screen.
 * The tab bar is the Buy / Sell segment's look (browse.css `x2f-segment`: a 2 px ink border on
 * surface-raised for the chosen tab, never orange), drawn with links (`aria-current="page"`)
 * because each tab is a page. A `#section` in the address is scrolled to once it has rendered, and
 * an old Security deep link to a section that moved is sent on to its tab (MOVED_SECTIONS).
 * DESIGNER-REVIEW: no Settings board yet.
 */
import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { Icon } from '../../ui/icons.js';
import { BLOCKED_PATH } from './BlockAction.js';
import { BLOCK_COPY } from './blockCopy.js';
import { TEAM_COPY, TEAM_PATH } from './teamCopy.js';
import { ACCOUNT_TYPE_COPY, ACCOUNT_TYPE_PATH } from './accountTypeCopy.js';
import { Alerts } from './Alerts.js';
import { OwnerOnly } from './OwnerOnly.js';
import { MOVED_SECTIONS, SETTINGS_COPY as C, SETTINGS_TABS, settingsTabOf, type SettingsTab } from './settingsCopy.js';
import '../browse/browse.css';
import '../screens.css';
import './settings.css';

/** The tab bar: one link per tab, the current one marked. */
export function SettingsTabs({ current }: { current: SettingsTab }) {
  return (
    <nav aria-label={C.tabsLabel} className="x2f-segment x2f-settings-tabs" data-part="settings-tabs">
      {SETTINGS_TABS.map((t) => (
        <Link
          key={t.id}
          to={t.to}
          className="x2f-segment__tab x2f-settings-tabs__tab"
          aria-current={t.id === current ? 'page' : undefined}
          data-tab={t.id}
          replace
        >
          {C.tab[t.id]}
        </Link>
      ))}
    </nav>
  );
}

/** How long a `#section` is looked for while the tab's cards load (they read the API first). */
const HASH_TRIES = 15;
const HASH_EVERY_MS = 200;

/** Scrolls to the element the address's `#id` names, once it exists (a deep link to a section). */
export function useHashTarget(hash: string): void {
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    if (id === '') return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const el = document.getElementById(id);
      if (el !== null) {
        el.scrollIntoView?.({ block: 'start' });
        return;
      }
      tries += 1;
      if (tries < HASH_TRIES) timer = setTimeout(look, HASH_EVERY_MS);
    };
    look();
    return () => clearTimeout(timer);
  }, [hash]);
}

/** One settings tab's page: the Settings title, the tab bar, then the tab's own cards. */
export function SettingsPage({ tab, screen, children }: { tab: SettingsTab; screen: string; children: ReactNode }) {
  const { hash } = useLocation();
  useHashTarget(hash);
  return (
    <main className="x2f-screen x2f-settings" data-screen={screen} data-settings-tab={tab}>
      <h1 className="x2f-screen__title">{C.title}</h1>
      <SettingsTabs current={tab} />
      <div className="x2f-settings__panel" data-part="settings-panel">
        {children}
      </div>
    </main>
  );
}

/** An old `/settings/security#<id>` whose section now lives on another tab: where to send it, or null. */
export function movedSection(pathname: string, hash: string): string | null {
  if (settingsTabOf(pathname) !== 'security') return null;
  const id = hash.replace(/^#/, '');
  const to = Object.hasOwn(MOVED_SECTIONS, id) ? MOVED_SECTIONS[id] : undefined;
  return to === undefined ? null : `${to}#${id}`;
}

/** Sends an old Security deep link on to the tab that now holds the section; null otherwise. */
export function MovedSectionRedirect() {
  const { pathname, hash } = useLocation();
  const to = movedSection(pathname, hash);
  return to === null ? null : <Navigate to={to} replace />;
}

/** A 56 px row link with a chevron, the settings lists' one look (`x2f-row-link`). */
export function SettingsRow({ to, part, children }: { to: string; part: string; children: ReactNode }) {
  return (
    <li className="x2f-list__row x2f-settings__row">
      <Link className="x2f-row-link" to={to} data-part={part}>
        <span>{children}</span>
        <Icon name="chevron-right" size={20} />
      </Link>
    </li>
  );
}

/** Settings → Alerts: the alarm sound, Jabber notices and the alerts list (moved off Security). */
export function AlertsSettings() {
  return (
    <OwnerOnly screen="settings-alerts">
      <SettingsPage tab="alerts" screen="settings-alerts">
        <Alerts />
      </SettingsPage>
    </OwnerOnly>
  );
}

/** Settings → Account: account type, team and blocked traders (each still its own screen and route). */
export function AccountSettings() {
  return (
    <OwnerOnly screen="settings-account">
      <SettingsPage tab="account" screen="settings-account">
        <section className="x2f-card" data-part="account-links" aria-labelledby="settings-account-h">
          <h2 className="x2f-card__title" id="settings-account-h">
            {C.accountTitle}
          </h2>
          <ul className="x2f-list">
            {/* Owner 2 Nov 2026: Settings > Account type (Trader or Vendor). */}
            <SettingsRow to={ACCOUNT_TYPE_PATH} part="account-type-link">
              {ACCOUNT_TYPE_COPY.title}
            </SettingsRow>
            {/* Plan 2 Task 18: the Team screen. */}
            <SettingsRow to={TEAM_PATH} part="team-link">
              {TEAM_COPY.title}
            </SettingsRow>
            {/* Task 37: the Blocked list (Block board's Settings, Blocked traders). */}
            <SettingsRow to={BLOCKED_PATH} part="blocked-link">
              {BLOCK_COPY.title}
            </SettingsRow>
          </ul>
        </section>
      </SettingsPage>
    </OwnerOnly>
  );
}

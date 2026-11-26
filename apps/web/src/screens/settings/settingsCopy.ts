/**
 * Settings tabs (owner demo note #101, 16 Nov 2026: "should be broken into tabs to segregate the
 * different similar functionalities that each tab covers"). The tab pages and which settings
 * screens each one owns, so the tab stays lit on a screen opened from it. No board yet:
 * DESIGNER-REVIEW on the grouping and the words.
 */

export type SettingsTab = 'security' | 'alerts' | 'account' | 'preferences' | 'help';

export const SETTINGS_PATH = '/settings';
export const SECURITY_PATH = '/settings/security';
export const ALERTS_PATH = '/settings/alerts';
export const ACCOUNT_PATH = '/settings/account';
export const SETTINGS_HELP_PATH = '/settings/help';
export const PREFERENCES_PATH = '/settings/preferences';

/** COPY-UNSIGNED (note #101): the screen title over the tabs, and each tab's name. */
export const SETTINGS_COPY = {
  title: 'Settings',
  tabsLabel: 'Settings sections',
  tab: { security: 'Security', alerts: 'Alerts', account: 'Account', preferences: 'Preferences', help: 'Help' } satisfies Record<SettingsTab, string>,
  /** The Security tab's card that links on to the session screens. */
  sessionsTitle: 'Sessions',
  /** The Account tab's one card. */
  accountTitle: 'Your account',
} as const;

/** COPY-UNSIGNED (owner-chosen scope, 26 Nov 2026): the Preferences tab, saved on this device. */
export const PREFERENCES_COPY = {
  cardTitle: 'On this device',
  intro: 'These choices are saved in this browser only. Another device or browser keeps its own.',
  sideLabel: 'Start on',
  sideHint: 'The list X2F opens on when you go to the home page.',
  side: { buy: 'Buy', sell: 'Sell' },
  currencyLabel: 'Preferred currency',
  currencyHint: 'Picked first on Buy and Sell when a link does not name a currency.',
  saved: 'Saved on this device.',
  clockTitle: 'Clock',
  clock: 'Times are always shown in UTC, on every device, so screenshots match.',
} as const;

export const SETTINGS_TABS: readonly { id: SettingsTab; to: string }[] = [
  { id: 'security', to: SECURITY_PATH },
  { id: 'alerts', to: ALERTS_PATH },
  { id: 'account', to: ACCOUNT_PATH },
  { id: 'preferences', to: PREFERENCES_PATH },
  { id: 'help', to: SETTINGS_HELP_PATH },
];

/** Every settings screen under the tab it is opened from (exact paths, so `account-type` is not `account`). */
const OWNED: readonly [RegExp, SettingsTab][] = [
  [/^\/settings\/(?:security|changes|devices|idle-reminder)\/?$/, 'security'],
  [/^\/settings\/(?:alerts|jabber|jabber\/events)\/?$/, 'alerts'],
  [/^\/settings\/(?:account|account-type|team|team\/log|blocked)\/?$/, 'account'],
  [/^\/settings\/preferences\/?$/, 'preferences'],
  [/^\/settings\/(?:help|privacy)\/?$/, 'help'],
];

/** The tab a settings path belongs to, or null for a path that is not a settings screen. */
export function settingsTabOf(pathname: string): SettingsTab | null {
  for (const [re, tab] of OWNED) if (re.test(pathname)) return tab;
  return null;
}

/**
 * Sections that moved off /settings/security into their own tab: an old deep link to one of them
 * (`/settings/security#alerts-h`) is sent on to the tab that now holds it, hash kept.
 */
export const MOVED_SECTIONS: Readonly<Record<string, string>> = {
  'alerts-h': ALERTS_PATH,
  'al-xmpp': ALERTS_PATH,
  'alarm-h': ALERTS_PATH,
};

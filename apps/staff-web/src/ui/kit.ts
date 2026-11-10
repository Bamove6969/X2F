/**
 * The staff app's one door to the UI kit (Plan 4 Task 16). The staff app has no components of its
 * own where the kit already has one: Button, Notice, Sheet, CantDoThat (every refusal), Switch,
 * ChoiceGroup, EmptyState, Countdown and the icons all come from apps/web's kit, so both apps
 * share one look and one behaviour. Import them from here, never from apps/web directly, so the
 * kit can move to a shared package later by changing this file alone.
 *
 * The auth and settings screens' field, card and code-list styles (`x2f-field`, `x2f-input`,
 * `x2f-card`, `x2f-codes`) are apps/web's screens.css, loaded by main.tsx with the tokens.
 */
export { Button } from '../../../web/src/ui/Button.js';
export { CantDoThat } from '../../../web/src/ui/CantDoThat.js';
export { ChoiceGroup, type ChoiceOption } from '../../../web/src/ui/Choice.js';
export { Countdown, formatRemaining } from '../../../web/src/ui/Countdown.js';
export { EmptyState } from '../../../web/src/ui/EmptyState.js';
export { Icon, type IconName } from '../../../web/src/ui/icons.js';
export { Notice } from '../../../web/src/ui/Notice.js';
export { Sheet } from '../../../web/src/ui/Sheet.js';
export { Switch } from '../../../web/src/ui/Switch.js';
// The News page's message card (apps/web, Plan 4 Task 28): NewsEditor's preview is the reader's card.
export { NewsMessage, type NewsItem } from '../../../web/src/screens/NewsMessage.js';

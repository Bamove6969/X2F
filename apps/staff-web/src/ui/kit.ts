/**
 * The staff app's one door to the UI kit (Plan 4 Task 16). The staff app has no components of its
 * own where the kit already has one: Button, Notice, Sheet, CantDoThat (every refusal), Switch,
 * ChoiceGroup, EmptyState, Countdown and the icons all come from apps/web's kit, so both apps
 * share one look and one behaviour. Import them from here, never from apps/web directly, so the
 * kit can move to a shared package later by changing this file alone.
 *
 * The auth and settings screens' field, card and code-list styles (`x2f-field`, `x2f-input`,
 * `x2f-card`, `x2f-codes`) are apps/web's screens.css, and the Terms box and signature pad's are
 * its setup.css; both are loaded by main.tsx with the tokens, the one other place that imports
 * from apps/web (test/oneDoor.test.ts fails on any other).
 */
export { Button } from '../../../web/src/ui/Button.js';
export { CantDoThat } from '../../../web/src/ui/CantDoThat.js';
export { ChoiceGroup, type ChoiceOption } from '../../../web/src/ui/Choice.js';
export { Countdown, formatRemaining } from '../../../web/src/ui/Countdown.js';
export { EmptyState } from '../../../web/src/ui/EmptyState.js';
// Plan 5 Task 11: the past-reputation evidence link (a new tab, no referrer, no opener; https only).
export { ExternalLink } from '../../../web/src/ui/ExternalLink.js';
export { installPrimaryLabelFit } from '../../../web/src/ui/fitPrimaryLabels.js';
export { Icon, type IconName } from '../../../web/src/ui/icons.js';
// DESIGN: owner 17 Nov black+orange rule: the orange retry on a load-fault line (ui/FaultLine.tsx).
export { RetryButton } from '../../../web/src/ui/RetryButton.js';
export { Notice } from '../../../web/src/ui/Notice.js';
export { Sheet } from '../../../web/src/ui/Sheet.js';
export { Switch } from '../../../web/src/ui/Switch.js';
// News (apps/web, Plan 4 Task 28): the message card NewsEditor lists the published messages with, and the
// News page's own post for its preview, "As traders will see it" (design final call 10 Nov 2026).
export { NewsMessage, type NewsItem } from '../../../web/src/screens/NewsMessage.js';
export { NewsPost } from '../../../web/src/screens/NewsPost.js';
// The Terms (owner 9 Nov 2026, p11-14: staff sign too): the trader app's Terms text and its version,
// never a copy, and its signature pad (design 9 Nov, p11-15, canvas ea2a9ca8), for the invite's Terms step.
export { SignaturePad } from '../../../web/src/screens/setup/SignaturePad.js';
export { TermsParagraphs } from '../../../web/src/screens/setup/TermsParagraphs.js';
export { KEY_POINTS, PRIVACY_HEADING, TERMS, TERMS_DRAFT_NOTE, TERMS_TEXT_VERSION } from '../../../web/src/screens/setup/termsText.js';
// The guided tours (owner 12 Nov 2026): the staff tours are data in the engine's own types (review 12 Nov, S2).
export type { TourDef, TourPage, TourStep } from '../../../web/src/tour/engine.js';

// Board parity (Task 15, Global Constraints "Visual parity"): every screen task calls
// `expectParity(page, '<Board>')` at 390×844, and trade-room screens also at 1280×800 against the
// Desktop board.
//
// Blocking (the test fails):
//   - exactly one visible [data-primary] on the page (none with `primary: false`, for a board
//     with no primary action);
//   - no horizontal scroll;
//   - no text-transform on any [data-username];
//   - every text of the board present verbatim (see `boardTexts` and `missingTexts`).
// Reported, not blocking (P3-M6): a screenshot diff against design/x2f-app/refs/<Board>.png at
// MAX_DIFF_PIXEL_RATIO, with [data-mask] regions and `masks` blacked out in both the reference and
// the page before the pixels are counted. The result goes into the test's annotations
// ("parity-pixels") and is printed as a "parity-pixels <Board> <viewport>: …" line; on a difference
// the reference and the page are attached to the HTML report (playwright-report/) for a person to
// review. The references come only from tools/parity/capture-refs.ts; a missing one is
// reported, never written. The viewport defaults to the board's canvas.json size, so the staff and
// mod boards (1280x900–1600) are shot at their reference's size. Known artifact: refs/SetupBackup.png
// reads "Addauthenticator app" (the canvas runtime drops the space before a filled-in {{choice}});
// it only adds pixel noise to the reported diff, and the PNG is not hand-edited.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Locator, type Page } from '@playwright/test';

export const BOARDS_DIR = fileURLToPath(new URL('../../../design/x2f-app/', import.meta.url));

/** A viewport as "<width>x<height>" (CSS pixels): 390x844, 1280x800, or a staff board's 1280x900–1600. */
export type ParityViewport = `${number}x${number}`;

/** The board's size in `boardsDir`/canvas.json as a ParityViewport (the size its reference was shot at). */
export function boardViewport(board: string, boardsDir = BOARDS_DIR): ParityViewport {
  const canvas = JSON.parse(readFileSync(join(boardsDir, 'canvas.json'), 'utf8')) as { boards: Record<string, { w: number; h: number }> };
  const b = canvas.boards[`${board}.dc.html`];
  if (!b) throw new Error(`no board "${board}" in ${join(boardsDir, 'canvas.json')}`);
  return `${b.w}x${b.h}`;
}

/** The ratio of differing pixels at which the (reported) screenshot comparison counts as a difference. */
export const MAX_DIFF_PIXEL_RATIO = 0.03;

/** Why a board's dates differ from the page's (KNOWN_EXCEPTIONS below). */
const DATE_FORMAT =
  "One date format (design review M1, ui/dates.ts): the page says the same moment as '16 Oct 2026, 10:14 UTC' (times of day as '10:14 UTC'), not the board's local weekday form.";

/**
 * Board texts that are known to be out of date and are not required on the page. The phone boards
 * win over the Desktop board where they disagree (lead ruling; HANDOFF: the desktop view is still
 * to be brought up to date with the phone screens). Desktop-only parts with no phone counterpart
 * (the progress steps, the counterparty card, the chat) are not exceptions.
 */
/**
 * The shared trader card (design gap list Job 2, "the kit": 48 px avatar, online line, three stat
 * tiles, badge chips + "+N") is drawn on the refreshed trade boards but not built yet; no trade
 * screen has it. Each text below is that card's, nothing else.
 */
const TRADER_CARD = 'Trader card from the shared kit (design gap list Job 2), not built yet: this text is the card\'s own.';
/**
 * CancelRequest's sheet sits over the secured pay step, which the board draws in the v2 hero (40/44
 * mono timer "61 min of 90 min · ends …") and v2 "Send exactly" card ("$412.50 USD for 1.250000
 * XMR"). Those are gap list Job 4 (trade screens to the boards), not the cancel sheet; the sheet's
 * own copy is checked in full.
 */
const NO_DISPUTE_BEFORE_PAID =
  'Design proto review P1 (8 Nov): the buyer gets no dispute before "I\'ve paid" (the machine refuses it, too-early); the board, drawn before that, still shows Open dispute on the unpaid pay step.';
const PAY_STEP_V2 = 'The secured pay step under the sheet in its v2 layout (design gap list Job 4, trade screens to the boards); not part of the cancel sheet (owner G56), whose copy is checked in full.';

/** Build spec j31a section 3 (owner p5-2, T-049, 9 Nov): drawn on wip/design-brief b5bb4faa; this repo's copy of the board predates it. */
const CANCEL_T049 =
  'T-049 (owner p5-2, build spec j31a section 3, boards on wip/design-brief b5bb4faa): the sheet reads "Cancelling is likely final" and its body no longer names the seller. design/x2f-app still has the 7 Nov board.';

const AD_CARD_V142 =
  'Owner #11 (8 Nov), boards v142 on wip/design-brief: the ad card shows the price bottom-left ("0.4%" over "above market", design final call 10 Nov, ui/margin.ts) and the range as two rows, XMR and fiat, each with its unit; the time moved to the price row. design/x2f-app still has the earlier card.';
/** Design final call (10 Nov 2026): one price wording everywhere, "0.4% above market" / "at market" (ui/margin.ts), never a signed figure. */
const PRICE_WORDING = 'Design final call (10 Nov 2026), ui/margin.ts: an offer with no margin reads "at market" (lower case, the same words as "0.4% above market"), so the board\'s "At market" is not on the card.';

/**
 * J-16 (Plan 3 Tasks 34/35): PostOffer lists up to 5 currencies with up to 3 bands each and up to 5
 * payment methods, so the board's one "Payment method" select, one "Currency" select (USD/EUR/GBP),
 * one market line and one "Who can trade with you" section are now pickers, chips, a market line
 * per currency and a "Minimum completed trades" choice per band. The board is still Task 21's.
 */
const FLEX_BOARD_PENDING = 'J-16 flex offers; board recapture pending (design)';

export const KNOWN_EXCEPTIONS: Partial<Record<string, { text: string; why: string }[]>> = {
  Review: [
    {
      text: 'Shown to them only after they rate you too.',
      why: 'Owner 2 Nov 2026 (R-007): no blind reveal, a review shows once submitted, so the card says "Shown on their profile as soon as you submit it." (COPY-UNSIGNED, Plan 5 Task 6; lead question).',
    },
  ],
  BuyOffers: [
    { text: '$0.10 above market', why: 'Owner Q1 (6 Nov): every offer is the market +/- %, so the card reads "0.03% above market" (ui/margin.ts), never a fixed amount over it.' },
    ...['$50 – $1,500Releases in ~8 min', '$100 – $3,000Releases in ~20 min', '$20 – $400Releases in ~30 min'].map((text) => ({ text, why: AD_CARD_V142 })),
  ],
  BuyerPay: [
    ...['SG', 'Vendor', 'Online · replies in about 4 min', 'Online', '4', '1,284', 'trades', '99.4%', 'positive', '275.4', 'XMR traded', 'Trusted', 'Fast', '+3'].map(
      (text) => ({ text, why: TRADER_CARD }),
    ),
    { text: 'Open dispute', why: NO_DISPUTE_BEFORE_PAID },
  ],
  SellerRefund: [
    ...['MK', 'Last seen 1 h ago', '1', '212', 'trades', '99%', 'positive', '41.7', 'XMR traded', 'Trusted', 'PGP verified', '+3'].map((text) => ({ text, why: TRADER_CARD })),
    // Owner 8 Nov (p6-1): nudges are optional, so the board's locked state (Cancel waits for 90 min
    // AND one nudge) is retired; the board predates the reversal and awaits a redraw.
    ...['No word from mira.k? After 90 min and at least one nudge, you can cancel and get your 1.250000 XMR back.', '90'].map((text) => ({
      text,
      why: "The board's nudge lock, retired by the owner 8 Nov (p6-1: nudges are optional, Cancel is available as soon as the time to pay passes); board redraw owed.",
    })),
  ],
  CancelRequest: [
    { text: 'Open dispute', why: NO_DISPUTE_BEFORE_PAID },
    ...['61', 'min', 'of 90 min · ends 1 Nov 2026, 15:21 UTC', '90', '1 Nov 2026, 15:21 UTC', '$412.50', 'for 1.250000 XMR', '1.250000', 'XMR'].map(
      (text) => ({ text, why: PAY_STEP_V2 }),
    ),
    ...[
      'Cancelling is final',
      "The 1.250000 XMR goes back to satoshi_ghost and this trade closes. Don't send any money after you cancel. If you've already paid, don't cancel: tap I've paid instead.",
    ].map((text) => ({ text, why: CANCEL_T049 })),
    {
      text: '•••-•••-4471',
      why: 'The board\'s masked "Zelle to" value is an example; what the row shows is still open for the owner (board note "Open · owner to choose"), and the page shows the seller\'s details the fixture serves.',
    },
  ],
  TradeFund: [
    {
      text: 'Rate (locked when you fund)',
      why: 'OD-5 (P3-I11): the rate and fiat total lock at Trade, so the row reads "Rate (locked when the trade started)".',
    },
    {
      text: 'Network fee (fast)',
      why: 'P3-M12: the seller pays the funding fee in their own wallet (spec 11.1), so the row reads "Network fee · set in your wallet".',
    },
    { text: '0.000062 XMR', why: 'The value of the replaced network-fee row (P3-M12): X2F does not set the funding fee.' },
  ],
  Main: [
    {
      text: 'X2F',
      why: 'The browse header shows logo D (an SVG mark), not the X2F wordmark: owner G-015 / design 9 Nov ("the pre-login mark is logo D"), built by the wide shell (Job 3). The Main board still carries the text wordmark until design redraws it.',
    },
  ],
  BuyMain: [
    {
      text: 'X2F',
      why: 'As Main: the header mark is logo D, not the X2F wordmark (owner G-015 / design 9 Nov); the BuyMain board still carries the text until design redraws it.',
    },
  ],
  Desktop: [
    {
      text: 'You pay · 62 min left',
      why: 'Countdown uses the phone boards\' minutes format ("1 h 2 min"); "62 min left" is out of date (lead ruling, UI kit README).',
    },
    {
      text: 'Encrypted. If a dispute is opened, a moderator can read this conversation.',
      why: 'The chat notice is the spec 6.6 text "Chats are encrypted. If a dispute is opened, a moderator can read this conversation." (DisputeRoom board, P3-M2); Task 20\'s controller step fixes the Desktop board.',
    },
    {
      text: 'Buying 1.250000 XMR from satoshi_ghost',
      why: 'The trade-room title on the BuyerPay phone board is "Buying from satoshi_ghost"; the phone board wins.',
    },
    {
      text: 'Drop payment proof here',
      why: 'The proof slot on the BuyerPay phone board reads "Add payment proof"; the phone board wins.',
    },
    {
      text: "Private details are blurred automatically for you to check next. It's best-effort, so please double-check before sending. Location and device info are removed.",
      why: 'The proof slot hint on the BuyerPay phone board reads "Private details are blurred for you to check next. Location and device info are removed."; the phone board wins.',
    },
    { text: 'Open dispute', why: NO_DISPUTE_BEFORE_PAID },
  ],
  // Owner S-017 (1 Nov 2026, lead job J-09): the recovery codes are required, so the backup step
  // first shows "Save your recovery codes" and only then the board's optional choice. setup.spec
  // checks the board on that second view, which keeps the board's options, "Add …" and "Skip for
  // now"; the board itself is not updated yet (its copy here is COPY-UNSIGNED, for design).
  SetupBackup: [
    {
      text: 'Add {{choice}}',
      why: 'Lead call (12 Nov 2026): the optional extra backups left this step (the ticked login methods replace them), so there is no "Add …" button; the board is checked on the recovery-code view.',
    },
    {
      text: 'Skip for now',
      why: 'Lead call (12 Nov 2026): with the optional extras gone there is nothing to skip; the saved recovery code goes straight on to the wallet.',
    },
    {
      text: 'Add a backup way to log in',
      why: 'S-017: by the time the optional backups show, a recovery code is already saved, so the heading reads "Add another backup (optional)" (COPY-UNSIGNED); the board predates S-017.',
    },
    {
      text: 'We recommend it. X2F has no email address or phone number for you, so if you lose your key or forget your password, we have no way to let you back in.',
      why: 'S-017: the recommendation moved to the required recovery-code view before it ("…a recovery code is your emergency way back in", COPY-UNSIGNED); the optional view says a security key or second PGP key also gets you back in. The board predates S-017.',
    },
    {
      text: "Your coins stay in your own wallet either way. Without a backup, you could lose this account and the reputation you've built on it.",
      why: 'Owner demo note #153 (23 Nov 2026): this box is removed from the recovery-code screen to cut scrolling. (Earlier, S-017 showed it word for word there.)',
    },
  ],
  SetupTerms: [
    {
      text: "No IP addresses are logged.",
      why: "Owner demo note #121 (23 Nov 2026, setup-terms key point): the page says \"We don’t track you. We never log or save your IP address, location, device details, email, or phone number. You stay completely anonymous, and there is no personal data on our servers to leak or share.\" (Terms version 2026-11-23).",
    },
    {
      text: "Disputed trades are kept up to 90 days, cleaned by our privacy tool, to train our moderators.",
      why: "Owner demo note #120 (23 Nov 2026, setup-terms key point): the page says \"Disputed trades will be kept up to 90 days, but first scrubbed by our in-house privacy tool to remove any personal and confidential information, and then used to train our moderators. They are deleted on the 90th day.\" (Terms version 2026-11-23).",
    },
    {
      text: "Completed trades are erased on day 30.",
      why: "Owner demo note #119 (23 Nov 2026, setup-terms key point): the page says \"To adhere to our privacy policy and to maintain strong confidentiality, all trades will be deleted on the 30th day after completion.\" (Terms version 2026-11-23).",
    },
    {
      text: "Moderators can read your trade chat only if a dispute is opened.",
      why: "Owner demo note #117 (23 Nov 2026, setup-terms key point): the page says \"Moderators can read your trade chat only if their presence is requested and a dispute is opened.\" (Terms version 2026-11-23).",
    },
    {
      text: '[TERMS TEXT: X2F connects buyers and sellers of Monero. It is not a party to any trade and never holds funds.]',
      why: 'Placeholder for the lawyer\'s text; the page shows the draft (screens/setup/termsText.ts), which states the spec\'s rules under the board\'s heading (Task 28).',
    },
    {
      text: '[TERMS TEXT: eligibility, one person per account, keeping your login keys safe.]',
      why: 'Placeholder for the lawyer\'s text; the page shows the draft (screens/setup/termsText.ts), which states the spec\'s rules under the board\'s heading (Task 28).',
    },
    {
      text: '[TERMS TEXT: how 2-of-3 escrow works, funding is a commitment, releases can\'t be undone.]',
      why: 'Placeholder for the lawyer\'s text; the page shows the draft (screens/setup/termsText.ts), which states the spec\'s rules under the board\'s heading (Task 28).',
    },
    {
      text: '[TERMS TEXT: when moderators can read chats, rulings, appeals, trading holds.]',
      why: 'Placeholder for the lawyer\'s text; the page shows the draft (screens/setup/termsText.ts), which states the spec\'s rules under the board\'s heading (Task 28).',
    },
    {
      text: '[TERMS TEXT: no IP logging; dispute records 30 days; anonymized training copies 6 months.]',
      why: 'Placeholder for the lawyer\'s text; the page shows the draft (screens/setup/termsText.ts), which states the spec\'s rules under the board\'s heading (Task 28).',
    },
    {
      text: '[TERMS TEXT]',
      why: 'Placeholder for the lawyer\'s text; the page shows the draft (screens/setup/termsText.ts), which states the spec\'s rules under the board\'s heading (Task 28).',
    },
    {
      text: '[TERMS TEXT: changes to these terms are shown at your next login.]',
      why: 'Placeholder for the lawyer\'s text; the page shows the draft (screens/setup/termsText.ts), which states the spec\'s rules under the board\'s heading (Task 28).',
    },
    {
      text: "If police or a government sends us a lawful request for data backed by a warrant, we will provide what little information we hold. That is exactly why we don't log IP addresses or ask for your name, phone number or email address: we can't hand over what we never collect. [Lawyer to word this.]",
      why: 'Owner demo notes 13 Nov 2026 (setup-terms, section 7): "a government agency"; the page says "If police or a government agency sends us …", the rest word for word (Terms version 2026-11-14). Owner demo note #107 (17 Nov): "... what little information we hold within the scope of the writ." (Terms version 2026-11-23).',
    },
    {
      text: 'If you post an ad, you pay a 1% fee when the trade completes.',
      why: 'Owner demo note #116 (23 Nov 2026, setup-terms second key point): the page says "If you post an ad, whether to sell or buy, you pay a 1% fee when the trade completes. Traders who just click on ads and engage in trades pay no fees." (Terms version 2026-11-23).',
    },
    {
      text: 'X2F never holds your coins.',
      why: 'Owner demo note #115 (23 Nov 2026, setup-terms first key point): his multisig explanation follows this sentence in the same point (Terms version 2026-11-23).',
    },
    {
      text: 'We answer lawful warrants with the little we have.',
      why: 'Owner demo note #102 (17 Nov 2026), then #122 (23 Nov 2026, setup-terms key points): the page now has his zero-log and lawful-orders paragraph in place of this line (Terms version 2026-11-23).',
    },
    {
      text: '[TERMS TEXT: 1% on completed trades, paid by the ad poster only; network fees; extra XMR sent to an escrow goes to the ad poster.]',
      why: 'Placeholder for the lawyer\'s text, and its last clause is superseded (extra XMR, owner 2026-10-20, spec 11.1); the page\'s draft Fees section says the 1% and the network fees only (Task 28).',
    },
    {
      text: 'End of Terms. Version [DATE].',
      why: 'The page shows the real version from GET /v1/terms in place of [DATE] (Task 28).',
    },
    {
      text: 'Please read to the end. The key points first:',
      why: 'Superseded on the canvas (design 9 Nov, p11-15, ea2a9ca8): the intro now reads "Read to the end. If you agree to X2F\'s rules and terms, …"; this repo\'s mirror of the board is from 26 Oct.',
    },
    {
      text: 'I accept',
      why: 'Superseded on the canvas (design 9 Nov, p11-15): the button reads "Start creating my account"; this repo\'s mirror of the board is from 26 Oct.',
    },
    {
      text: 'Dispute records are kept for 30 days.',
      why: 'Superseded on the canvas (design 9 Nov, p11-9; owner 8 Nov 30/90 ruling): two key points, "Completed trades are erased on day 30." and "Disputed trades are kept up to 90 days, …"; this repo\'s mirror of the board is from 26 Oct.',
    },
  ],
  // Owner demo notes (12 Nov 2026, /setup/login): every method is a checkbox, several can be
  // ticked and are set up one after another, so the lead says so (COPY-UNSIGNED). The board predates
  // the notes.
  SetupLogin: [
    {
      text: 'Choose one for now. You can add others later in Settings.',
      why: 'Owner demo notes (12 Nov 2026): several methods can be ticked; the lead reads "Tick every way you want to use. We\'ll set them up one after another, then show you your recovery code. …" (COPY-UNSIGNED). The board predates the notes.',
    },
  ],
  SetupPgpKey: [
    {
      text: 'Add your PGP public key',
      why: 'Owner demo note #143 (23 Nov 2026): the heading reads "Add your public PGP key".',
    },
    {
      text: 'Set up your account',
      why: 'Sign-up round 3 (signup-r3-spec-2026-11-13.md, owner 13 Nov 2026): the /setup/pgp-key header reads "Adding your public PGP key".',
    },
    {
      text: 'Public key -----BEGIN PGP PUBLIC KEY BLOCK----- mDMEZx3kQhYJKwYBBAHaRw8BAQdA0r9p … -----END PGP PUBLIC KEY BLOCK-----',
      why: 'The board\'s example key, shortened with "…", is not a key: the key check (type, expiry, fingerprint) needs a real pasted key, so the page shows the key the test pastes (Task 28).',
    },
    {
      text: '-----BEGIN PGP PUBLIC KEY BLOCK----- mDMEZx3kQhYJKwYBBAHaRw8BAQdA0r9p … -----END PGP PUBLIC KEY BLOCK-----',
      why: 'The same example key inside the textarea (see above).',
    },
    {
      text: '3F2A 9C41 7B0E D5A2 61C8 0E4B 92D7 1F6A C3B8 0D15',
      why: "The example key's fingerprint; the page shows the pasted key's own fingerprint in the same grouping (Task 28).",
    },
    // Review of third-signup-r3 (16 Nov 2026), M5b. The header change is the owner's (demo note
    // 2708e47a, 13 Nov 2026, on /setup/pgp-key: "Instead of create account - Adding your public PGP
    // key"). The board keeps its old title until design redraws it and recaptures refs/SetupPgpKey.png
    // (tools/parity/capture-refs.ts needs the canvas runtime support.js); remove this then.
    {
      text: 'Set up your account',
      why: 'Owner demo note 2708e47a (13 Nov 2026): the /setup/pgp-key header reads "Adding your public PGP key" instead; board redraw and reference recapture owed (design).',
    },
  ],
  SetupPgpChallenge: [
    // Review of third-signup-r3 (16 Nov 2026), M5b, found once SetupPgpKey passed: f1068c58 names
    // PGPony in the app list, from the owner's demo note e6d8122c (13 Nov 2026: "recommend PGPony as
    // the recommended Android app") and signup-r3 spec item 7. The board predates it; remove this
    // when design redraws the board and recaptures refs/SetupPgpChallenge.png.
    {
      text: 'Open your PGP app (Kleopatra, GPG Suite or OpenKeychain) and decrypt it.',
      why: 'Owner demo note e6d8122c (13 Nov 2026), signup-r3 spec item 7: the page reads "Open your PGP app (Kleopatra, GPG Suite, PGPony or OpenKeychain) and decrypt it."; board redraw and reference recapture owed (design).',
    },
    {
      text: 'Open your PGP app (Kleopatra, GPG Suite or OpenKeychain) and decrypt it.',
      why: 'Sign-up round 3 (owner 13-16 Nov 2026): PGPony is the PGP app recommended on Android, so the step reads "Open your PGP app (Kleopatra, GPG Suite, PGPony or OpenKeychain) and decrypt it."; owner demo note #145 (23 Nov 2026) then ends it "... and decrypt the message to find the hidden login code."',
    },
    {
      text: '4:12',
      why: 'The inner value of "Expires in 4:12": the page\'s masked Countdown already stands for it in that sentence, and one masked element covers one board text (Task 28).',
    },
  ],
  // Design real-app review item 6 (766747ea, owner Q54): this step now asks for the ONE private
  // username, and the public display name has its own screen after it (DisplayName.tsx). The board
  // still draws the old public username; it is not updated yet (the page's copy is for design).
  SetupUsername: [
    {
      text: 'Pick a username',
      why: 'Owner demo note (12 Nov 2026, /setup/name): the heading reads "Pick a unique username" (his words). The board predates the note.',
    },
    {
      text: 'lumen.k is available',
      why: "The board's example name. The page's live tick (POST /v1/register/name-check) says the same sentence for the name typed (\"lumen-login-7 is available\" in setup.spec), which is not the board's public example.",
    },
    {
      text: 'This is how traders see you. No email or phone number needed, now or ever.',
      why: 'Item 6: the username here is private (owner note #124: "You will type this to log in each and every time, and only you will know what it is. …"); "This is how traders see you" moved to the display-name screen. The board predates item 6.',
    },
    {
      text: "5 to 20 characters: letters, numbers, dots, dashes and underscores. It shows exactly as you type it. Pick something that isn't your real name or used elsewhere.",
      why: 'Item 6: split between the two names. The username\'s help keeps the rules and "Pick something that isn\'t your real name or used elsewhere."; "It shows exactly as you type it." is on the display-name screen, the name traders see. The board predates item 6. Owner demo note #126 (23 Nov 2026, on /setup/name: "I want username changed to minimum of 8 characters"): the page says 8 to 20.',
    },
  ],
  SetupWelcome: [
    ...[
      'Your account is ready. Trade Monero for cash, bank transfers and payment apps, with every trade protected by escrow.',
      'You log in with',
      'Backup login',
      'You get paid to',
      'You can change any of these later in Settings.',
    ].map((text) => ({
      text,
      why: 'Owner demo notes 12 Nov 2026 (his own words): the lead line and the rows became his checklist ("Configured your secure methods of logging into X2F", "Emergency login method: recovery code documented", "Connected your wallet", one green tick each) and "Any information provided above can be changed later in Settings." (owner-copy.spec.ts). COPY-UNSIGNED, DESIGNER-REVIEW: the board is to be redrawn.',
    })),
    {
      text: 'Welcome to X2F, lumen.k',
      why: 'Owner demo note #165 (23 Nov): "Maybe we could say in big letters \'Welcome to\' and then X2F in our logo ... ditch the comma at the end of X2F. We will stay with their name below the welcoming to X2F, with a comma after their name". The h1 is "Welcome to" and the large logo (named X2F), and the name with its comma is its own line below. DESIGNER-REVIEW: the board is to be redrawn.',
    },
    {
      text: 'Authenticator app',
      why: 'The board\'s example backup login. An authenticator app is no backup login any more (design build gaps Job 1, 5fee431d), and the recovery codes are required at sign-up (owner S-017), so after the backup step the summary reads "Recovery codes" (asserted in setup.spec). The board predates both.',
    },
  ],
  SetupWallet: [
    ...['Choose the wallet you want to be paid to. X2F never holds your coins.', 'Receive address from {{appName}}'].map((text) => ({
      text,
      why: 'Owner demo notes 12 Nov #32 and 16 Nov #96: the wallet names are a plain recommendation list ("and many more"), not chips that pick an app, then one field: "Use your favourite wallet and enter a receive address from it". COPY-UNSIGNED, DESIGNER-REVIEW: the board is to be redrawn.',
    })),
    {
      text: "Whenever you add a payout wallet, we'll ask you to confirm it's you, and we'll show an alert. Want extra protection? In Security settings, you can make new wallets wait 24 hours before they can be paid.",
      why: 'Superseded by spec 6.3 "Decided 2026-10-23" and "Wallet rules refined" (owner 2026-10-24): there is no 24-hour setting any more, and the first wallet in setup needs no confirm and never waits. The page says so instead; the canvas copy is for the lead to update (Task 28).',
    },
  ],
  SellOffers: [
    {
      text: '$20 – $200Deposit required',
      why: 'Buyer deposits were removed (plan Revision 2026-10-18, spec 2.5); the card shows its range and, when the API knows it, the typical time ("Pays in ~N min").',
    },
    ...['$50 – $2,000Pays in ~6 min', '$100 – $5,000Pays in ~15 min'].map((text) => ({ text, why: AD_CARD_V142 })),
    { text: 'At market', why: PRICE_WORDING },
  ],
  PostOffer: [
    {
      text: 'Bank transfer (ACH)',
      why: 'The board names ACH differently from the catalog ("ACH bank transfer (US)", data/payment-methods.json); the board fix is a design to-do (lead, 2026-10-27).',
    },
    ...['Anyone', '5+', '10+', '50+'].map((text) => ({
      text,
      why: 'Owner, 8 Nov ("This will be 5, 10, 25, 50"): Minimum completed trades is a segmented choice, No minimum / 5 / 10 / 25 / 50; the board still draws the old select (design to-do).',
    })),
    {
      text: '$50 – $2,000',
      why: 'Owner #11 (8 Nov), boards v142: the preview shows the range in both units, each row with its unit ("$50 – $2,000 USD"); design/x2f-app still has the one-row preview.',
    },
    ...['−', '+'].map((text) => ({
      text,
      why: 'Owner F1 (7 Nov): the vendor picks Above or Below market and types the percentage, at most 50% (J-02); the board still draws the ±0.1% stepper buttons (design to-do).',
    })),
    ...[
      'Payment method',
      'Currency',
      'EUR',
      'GBP',
      "Market $329.90 / XMR right now. Your price follows the market, so it's always {{priceNow}} at today's rate.",
      'Who can trade with you',
    ].map((text) => ({ text, why: FLEX_BOARD_PENDING })),
  ],
  // Task 27's dispute boards: parts other tasks build (Plan 5's evidence and unblurred proof, Task 20's chat).
  DisputeOpen: [
    {
      text: 'That includes your messages from before the trade started. They may also ask you for an unblurred copy of your proof. A moderator usually replies within 4 hours.',
      why: 'Owner Q38 (6 Nov) via design (board v119, not in this repo yet): the 4-hour line is replaced by the hourglass line.',
    },
    { text: 'Zelle screenshot', why: 'Plan 5 (proof pipeline) and Task 23 (proof slot): the proof already in the trade.' },
    { text: 'Already in this trade, blurred', why: 'Plan 5 (proof pipeline) and Task 23 (proof slot): the proof already in the trade.' },
    { text: 'Included', why: 'Plan 5 (proof pipeline) and Task 23 (proof slot): the proof already in the trade.' },
    { text: 'A moderator looks at what happened and decides where the 1.25 XMR goes. It stays locked in escrow until then.', why: 'Design kit handoff 1.5 and kit review 5 (8 Nov): prose XMR has 6 places, so the page reads 1.250000 XMR; the board predates the rule (design to re-export).' },
  ],
  DisputeRoom: [
    { text: '1.25 XMR locked in escrow', why: 'Board v119 (design 7 Nov, not in this repo yet): the amount is an inner block, six decimals.' },
    {
      text: 'Replied in 38 min · ruling due by Fri 16 Oct, 10:14 (in 23 h)',
      why: 'Owner Q38 (6 Nov): traders never see the 48-hour deadline; the hourglass is the one deadline (board v119).',
    },
    { text: 'Fri 16 Oct, 10:14', why: 'Owner Q38 (6 Nov): the ruling-due date is not shown (board v119).' },
    { text: 'Your Zelle screenshot', why: 'Plan 5 (proof pipeline) and Task 23 (proof slot): the proof already in the trade.' },
    {
      text: 'She can read this whole chat, including messages from before the trade. Moderators only ever contact you here.',
      why: 'The app cannot know a moderator\'s gender and says "They" (Task 27; lead/owner question).',
    },
    { text: 'satoshi_ghost · 10:20', why: 'Task 20 (ChatPanel): chat messages.' },
    { text: "Nothing from Zelle on my side yet. I'll check again tonight.", why: 'Task 20 (ChatPanel): chat messages.' },
    { text: 'X2F Moderator', why: 'Task 20 (ChatPanel): a moderator\'s chat message carries the badge.' },
    { text: 'sarah.v · 10:53', why: 'Task 20 (ChatPanel): chat messages.' },
    {
      text: "Hi both. I've read the chat and seen the proof. mira.k, please send me the unblurred screenshot so I can check the sender name. satoshi_ghost, please look in your Zelle activity for $412.50 today with the note K7M2-9QXA-4FTR-8WPN.",
      why: 'Task 20 (ChatPanel): chat messages.',
    },
    { text: "sarah.v asked you for the unblurred proof. Only she will see it. satoshi_ghost won't.", why: "Plan 5 (SendUnblurred) with Plan 4's proof request." },
    { text: 'Send unblurred proof to sarah.v', why: "Plan 5 (SendUnblurred) with Plan 4's proof request." },
    { text: 'Replied in 38 min · ruling due by Fri 16 Oct, 10:14 (in 23 h)', why: DATE_FORMAT },
    { text: 'Fri 16 Oct, 10:14', why: DATE_FORMAT },
    { text: "10:14 · You opened a dispute: I paid, but the seller hasn't released", why: DATE_FORMAT },
    { text: '10:52 · Moderator sarah.v joined this dispute', why: DATE_FORMAT },
  ],
  DisputeRuling: [
    { text: 'sarah.v · Thu 15 Oct, 14:30', why: DATE_FORMAT },
    { text: '1.25 XMR goes to you', why: 'Design kit handoff 1.5 and kit review 5 (8 Nov): prose XMR has 6 places, so the page reads 1.250000 XMR; the board predates the rule (design to re-export).' },
    {
      text: 'To Cake Wallet, address ending …k3Fz, once the appeal window closes.',
      why: 'Superseded (design review 2026-11-01 fix 2; board DisputeRuling on wip/design-brief; Plan 4 "A1 dropped"): no wait for the window. The newer board reads "Sent to …", but nothing executes the payout yet (C11 review I1, NEEDS_PLAN_4_RULING_PAYOUT), so the page reads "Goes to Cake Wallet, address ending …k3Fz." (COPY-UNSIGNED) until the API reports it executed.',
    },
    {
      text: "Either of you can appeal until Sat 17 Oct, 14:30. An appeal goes to a senior moderator or the owner who hasn't seen this case. If nobody appeals, the XMR is released when the window closes.",
      why: 'Superseded (design review 2026-11-01 fix 2; board DisputeRuling on wip/design-brief; spec Revision 2026-10-29c "Liens"): no wait for the window; the page says "(48 h)" and that an overturned ruling puts a lien on whoever received the coins.',
    },
    { text: 'Open · 47 h 58 min left', why: 'The appeal countdown in the minutes format: a mask cannot stand for a value with a unit inside; dispute.spec.ts checks its shape.' },
    { text: '47 h 58 min', why: 'The appeal countdown in the minutes format: a mask cannot stand for a value with a unit inside; dispute.spec.ts checks its shape.' },
  ],
  BuyQuote: [
    {
      text: 'Paid by satoshi_ghost',
      why: 'OD-4 (spec 11.1): the release network fee comes off the payout, so the row reads "about 0.0001 XMR, taken from the payout".',
    },
    { text: 'Deposit', why: 'No buyer deposits (spec 2.5, plan Revision 2026-10-18): the quote has no Deposit row (plan Task 18).' },
    { text: 'None for this trade', why: 'The value of the removed Deposit row (spec 2.5).' },
  ],
  Wallet: [
    {
      text: "Saving asks you to confirm it's you. Confirm with a PGP key, passkey or security key and the wallet works at once; with a password or authenticator code it waits 24 hours before it can be paid.",
      why: 'Superseded by spec 6.3 "Wallet rules refined" (owner 2026-10-24): the first wallet never waits and a batch shares one wait, so the note under the form follows the account\'s own GET /v1/wallets/rule (ruleNote in screens/wallets-model.ts) instead of one fixed sentence (Task 29).',
    },
  ],
};

/**
 * Board-only markers, stripped so they are not treated as app copy. Only the two shapes the boards
 * actually use are removed (not every sentence that mentions an example, so real copy that happens
 * to say "example" is kept):
 *   - a trailing " · Example" (or "· examples/sample/samples") after a header line;
 *   - a sentence of the form "<subject> are examples." / "… are samples." (e.g. "Figures are
 *     examples."), and the one-off "This is an example key." note;
 *   - the "Draft copy" badge the boards put on unsigned copy.
 */
export function withoutBoardMarkers(text: string): string {
  const unmarked = text.replace(/\s*·\s*(?:examples?|samples?)\s*$/i, '');
  return unmarked
    .split(/(?<=[.?])\s+/)
    .filter((sentence) => {
      const s = sentence.trim();
      if (/\bare (?:examples?|samples?)\.?$/i.test(s)) return false;
      if (/^This is an example key\.?$/i.test(s)) return false;
      // The boards' unsigned-copy badge (design marks copy the owner has not signed yet).
      if (/^Draft copy\.?$/i.test(s)) return false;
      return true;
    })
    .join(' ')
    .trim();
}

/** The sentinel a template placeholder ({{…}}) or a masked page region collapses to. */
const MASK = '\u0000';
const MASK_ATTR = 'data-parity-mask';

/**
 * The texts on `board` (design/x2f-app/<board>.dc.html) in its default state, read from the
 * board's template: for every element that holds text of its own, that element's whole text
 * (textContent, whitespace collapsed), so "Trade <code> · <method>" stays one text even when the
 * app splits it into nodes. Left out: scripts, styles, <helmet>, SVG, <sc-if> branches that are off
 * by default, text the board hides visually (screen-reader-only labels), the board-only example
 * markers and the board's KNOWN_EXCEPTIONS. A template
 * placeholder ({{…}}, filled in by the canvas runtime) becomes the MASK sentinel, so the fixed copy
 * around it is still checked (as an anchored pattern in `missingTexts`); a text that is nothing but
 * placeholders is dropped. `within` narrows to one CSS selector's first match; `boardsDir` reads the
 * board from another folder (the tests use it). Parsing happens in
 * `page` with DOMParser, which runs nothing. Throws if a KNOWN_EXCEPTIONS entry is no longer on the
 * board (a stale exception to remove).
 */
export async function boardTexts(page: Page, board: string, o: { within?: string; boardsDir?: string } = {}): Promise<string[]> {
  const html = readFileSync(join(o.boardsDir ?? BOARDS_DIR, `${board}.dc.html`), 'utf8');
  const raw = await page.evaluate(
    ({ html, within }) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const root = doc.querySelector('x-dc') ?? doc.body;
      for (const el of Array.from(root.querySelectorAll('script, style, helmet, title, template, noscript, svg'))) el.remove();
      // The board's own design notes (a "Design notes" section beside the app frame) annotate the
      // board for the team; they are not app copy.
      for (const el of Array.from(root.querySelectorAll('[aria-label="Design notes"]'))) el.remove();
      for (const el of Array.from(root.querySelectorAll('sc-if'))) {
        if (el.getAttribute('hint-placeholder-val') === '{{false}}') el.remove();
      }
      // Text the board itself hides visually (the screen-reader-only pattern: a box of at most 1 px
      // with its overflow hidden or clipped) is not visible copy; the page may hide it the same way.
      // The style attribute is read as text: under the app's CSP (no inline styles) the parsed
      // board's CSSOM stays empty.
      const tiny = (v: string | undefined) => v === '0' || v === '0px' || v === '1px';
      for (const el of Array.from(root.querySelectorAll('[style]'))) {
        const st = new Map<string, string>();
        for (const decl of (el.getAttribute('style') ?? '').split(';')) {
          const i = decl.indexOf(':');
          if (i > 0) st.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim().toLowerCase());
        }
        if (tiny(st.get('width')) && tiny(st.get('height')) && (st.get('overflow') === 'hidden' || st.has('clip') || st.has('clip-path'))) el.remove();
      }
      const scope = within ? root.querySelector(within) : root;
      if (!scope) throw new Error(`no ${within} on the board`);
      // A <select>'s options are copy of their own (each is checked on its own below), not part of
      // the label or row around the select: "Currency" and "USD", never "Currency USDEURGBP".
      const textOf = (node: Node, root: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        if (node !== root && (node as Element).matches('select')) return '';
        return Array.from(node.childNodes)
          .map((n) => textOf(n, root))
          .join('');
      };
      const out: string[] = [];
      for (const el of [scope, ...Array.from(scope.querySelectorAll('*'))]) {
        const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
        if (!own) continue;
        const text = textOf(el, el).replace(/\s+/g, ' ').trim();
        if (text !== '') out.push(text);
      }
      return out;
    },
    { html, within: o.within ?? null },
  );
  const marked = raw.map(withoutBoardMarkers);
  const exceptions = KNOWN_EXCEPTIONS[board] ?? [];
  // A stale exception is caught on a full-board read; a `within` read only sees part of the board,
  // so an exception that lives elsewhere is expected to be absent there.
  if (!o.within) {
    for (const e of exceptions) {
      if (!marked.includes(e.text)) {
        throw new Error(`KNOWN_EXCEPTIONS[${board}] lists "${e.text}", which is not on the board any more — remove the stale exception.`);
      }
    }
  }
  const skip = new Set(exceptions.map((e) => e.text));
  const texts: string[] = [];
  for (const m of marked) {
    if (m === '' || skip.has(m)) continue;
    // A placeholder stands for runtime-filled text; the fixed copy around it must still be present.
    const pattern = m.replace(/\{\{.*?\}\}/g, MASK);
    if (pattern.replaceAll(MASK, '').trim() === '') continue; // nothing but placeholders
    if (!texts.includes(pattern)) texts.push(pattern);
  }
  return texts;
}

// The body of a value-shaped text (a lone timer, amount, count or trade code): digits and the few
// symbols/units such values use, or a code like K7M2-9QXA-4FTR-8WPN, nothing with words in it. A
// masked page region may only stand in for such a value, so a masked countdown can cover "28:12"
// on the board, but losing "1.237500 XMR is yours" or "· Zelle" cannot hide behind a mask.
const VALUE = String.raw`(?:[\d$.,:\s]+(?:XMR|USD|min|h|s|left)?|[A-Z0-9]{4}(?:-[A-Z0-9]{4})+)`;
const VALUE_SHAPED = new RegExp(`^${VALUE}$`);

/**
 * The kind of a value-shaped text, so a lone mask only stands in for a board value like the one it
 * hides: a masked countdown is not a missing amount. A code is a K7M2-9QXA-… trade code; money has a
 * currency sign or unit or a decimal point; a time has a colon or a time unit; anything else is a
 * count.
 */
export function valueKind(s: string): 'code' | 'money' | 'time' | 'count' {
  if (/^[A-Z0-9]{4}(?:-[A-Z0-9]{4})+$/.test(s)) return 'code';
  if (/[$]|XMR|USD|\d\.\d/.test(s)) return 'money';
  if (/\d:\d|\d\s*(?:h|min|s)\b|\bleft$/.test(s)) return 'time';
  return 'count';
}

const escapeRe = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A board text with MASKs (runtime-filled {{…}} placeholders): each MASK matches any text. */
function boardPattern(s: string): RegExp {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test harness, inputs are board/page text in our own fixtures, escaped by escapeRe
  return new RegExp(`^${s.split(MASK).map(escapeRe).join('.+?')}$`);
}

/**
 * A shown page text with MASKs (masked regions inline in a sentence): each MASK matches only a
 * value-shaped piece (VALUE), so the mask never absorbs words of the board text around it.
 */
function pagePattern(s: string): RegExp {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test harness, inputs are board/page text in our own fixtures, escaped by escapeRe
  return new RegExp(`^${s.split(MASK).map(escapeRe).join(VALUE)}$`);
}

/** One visible element's whole text, with the ids of the masked elements it contains. */
interface Shown {
  text: string;
  masks: number[];
}

/**
 * The `texts` (from `boardTexts`) that no visible element on the page shows. A text matches when:
 *   - some visible element's whole text equals it (whitespace collapsed); or
 *   - the text has a MASK (a {{…}} placeholder) and its pattern matches some shown text; or
 *   - a shown text has masked elements (inside [data-mask] or one of `masks`) inline where the
 *     text's changing part is, and every piece they stand for is value-shaped, e.g.
 *     "You pay · <Countdown/> left" covers "You pay · 62 min left" but not "You get · …"; or
 *   - the text is value-shaped and a masked element of the same kind (`valueKind`: time, money,
 *     code, count) stands on its own for it (a lone timer).
 * Use is tied to the masked ELEMENT: each masked element covers at most one board text, however
 * many wrapper elements repeat its sentence, and a {{…}} board text consumes the shown text (and
 * the masks in it) it matched.
 */
export async function missingTexts(page: Page, texts: string[], masks: Locator[] = []): Promise<string[]> {
  for (const m of masks) await m.evaluateAll((els, attr) => els.forEach((e) => e.setAttribute(attr, '')), MASK_ATTR);
  const { shown, standalone } = await page.evaluate(
    ({ sel, mask }) => {
      // Shown to a sighted person: rendered, at least 2x2 px, and inside every box that clips it, so
      // screen-reader-only text (1 px clip), a 0x0 box, text at left:-9999px, text off the right of
      // a page that cannot scroll, or text cut off by a non-scrolling overflow:hidden box does not
      // count. A box that scrolls (and the page, when it scrolls) clips to its whole scrolled
      // content, so text further down a scrolling container (an app shell scrolling in <main>)
      // still counts.
      const scrolls = (o: string) => o === 'auto' || o === 'scroll';
      const inside = (r: DOMRect, left: number, top: number, right: number, bottom: number) =>
        r.right > left && r.bottom > top && r.left < right && r.top < bottom;
      const visible = (el: Element): boolean => {
        // An <option> has no box of its own in a closed select; it is shown when its select is.
        if (el.matches('option, optgroup')) {
          const select = el.closest('select');
          return select !== null && visible(select);
        }
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
        let r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const doc = document.documentElement;
        for (let a = el.parentElement; a !== null && a !== doc && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const b = a.getBoundingClientRect();
          const sx = scrolls(cs.overflowX);
          const sy = scrolls(cs.overflowY);
          const left = sx ? b.left - a.scrollLeft : b.left;
          const top = sy ? b.top - a.scrollTop : b.top;
          const right = sx ? left + a.scrollWidth : b.right;
          const bottom = sy ? top + a.scrollHeight : b.bottom;
          if (!inside(r, left, top, right, bottom)) return false;
          // Scrolled into view it sits within this box, so the boxes further out clip the box.
          if (sx || sy) r = b;
        }
        // The page: its whole scrolled area when it scrolls that way, else the viewport.
        const root = getComputedStyle(doc);
        const body = getComputedStyle(document.body);
        const pageX = !(root.overflowX === 'hidden' || root.overflowX === 'clip' || body.overflowX === 'hidden' || body.overflowX === 'clip');
        const pageY = !(root.overflowY === 'hidden' || root.overflowY === 'clip' || body.overflowY === 'hidden' || body.overflowY === 'clip');
        const left = -window.scrollX;
        const top = -window.scrollY;
        return inside(r, left, top, pageX ? left + doc.scrollWidth : window.innerWidth, pageY ? top + doc.scrollHeight : window.innerHeight);
      };
      // The outermost visible masked elements, each with an id.
      const ids = new Map<Element, number>();
      const standalone: { id: number; text: string }[] = [];
      for (const el of Array.from(document.body.querySelectorAll(sel))) {
        if (el.parentElement?.closest(sel) || !visible(el)) continue;
        const id = ids.size;
        ids.set(el, id);
        // Standing on its own: no text of the parent's own beside it (not inline in a sentence).
        const inline = Array.from(el.parentElement?.childNodes ?? []).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
        if (!inline) standalone.push({ id, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim() });
      }
      const read = (node: Node, found: number[], from: Node = node): string => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const el = node as Element;
        if (el.matches('script, style, template')) return '';
        // As boardTexts: a select's options are texts of their own, not part of the text around it.
        if (el.matches('select') && node !== from) return '';
        if (el.matches(sel)) {
          const id = ids.get(el);
          if (id !== undefined) found.push(id);
          return mask;
        }
        return Array.from(el.childNodes)
          .map((n) => read(n, found, from))
          .join('');
      };
      const shown: { text: string; masks: number[] }[] = [];
      const seen = new Set<string>();
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (el.matches('script, style, template') || el.closest(sel) || !visible(el)) continue;
        const found: number[] = [];
        const text = read(el, found).replace(/\s+/g, ' ').trim();
        if (text === '') continue;
        // Wrapper elements repeat their only child's text: one copy per (text, masks).
        const key = `${text}\u0001${found.join(',')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        shown.push({ text, masks: found });
      }
      return { shown, standalone };
    },
    { sel: `[data-mask], [${MASK_ATTR}]`, mask: MASK },
  );
  for (const m of masks) await m.evaluateAll((els, attr) => els.forEach((e) => e.removeAttribute(attr)), MASK_ATTR);

  // Exact matches go first and take their shown text, so a {{…}} pattern ("Add …") cannot be
  // satisfied by a sentence another board text already accounts for ("Add a backup login?").
  const exact = new Set<string>();
  const usedMask = new Set<number>();
  const usedShown = new Set<Shown>();
  const free = (s: Shown) => !usedShown.has(s) && s.masks.every((id) => !usedMask.has(id));
  const take = (s: Shown) => {
    usedShown.add(s);
    for (const id of s.masks) usedMask.add(id);
  };
  // The best free shown text `ok` accepts: the fewest masks, then the shortest, so an ancestor that
  // joins several sentences never takes masks a single sentence could have used.
  const pick = (from: Shown[], ok: (s: Shown) => boolean): Shown | undefined =>
    from
      .filter((s) => free(s) && ok(s))
      .sort((x, y) => x.masks.length - y.masks.length || x.text.length - y.text.length)[0];
  // Shown sentences with masks inline in them, and real copy beside the masks.
  const masked = shown.filter((s) => s.text.includes(MASK) && s.text.replaceAll(MASK, '').trim() !== '');

  for (const t of texts) {
    if (t.includes(MASK)) continue;
    const hit = shown.find((s) => s.masks.length === 0 && s.text === t);
    if (hit) {
      exact.add(t);
      usedShown.add(hit);
    }
  }

  const missing: string[] = [];
  for (const t of texts) {
    if (t.includes(MASK)) {
      // A board placeholder text: present if its fixed copy is on the page around anything. It takes
      // the shown text it matched (the fewest masks first), so that one cannot cover another text.
      const re = boardPattern(t);
      const hit = pick(shown, (s) => re.test(s.text));
      if (hit) take(hit);
      else missing.push(t);
      continue;
    }
    if (exact.has(t)) continue;
    const hit = pick(masked, (s) => pagePattern(s.text).test(t));
    if (hit) {
      take(hit);
      continue;
    }
    const kind = VALUE_SHAPED.test(t) ? valueKind(t) : null;
    const lone = kind === null ? undefined : standalone.find((m) => !usedMask.has(m.id) && valueKind(m.text) === kind);
    if (lone !== undefined) {
      usedMask.add(lone.id);
      continue;
    }
    missing.push(t);
  }
  return missing;
}

/**
 * Board parity for the page as it is now; see the top of this file. Throws on a blocking failure.
 * `primary: false` is for a board with no primary action (Main, BuyMain: only the tab bar), where
 * the page must have no [data-primary] at all. It first sets the page's viewport to `o.viewport`
 * (default: the board's canvas.json size) and
 * leaves it there, so a test that goes on after it runs at that size.
 */
export async function expectParity(
  page: Page,
  board: string,
  o: { masks?: Locator[]; viewport?: ParityViewport; refsDir?: string; boardsDir?: string; primary?: boolean } = {},
): Promise<void> {
  // The board's own canvas.json size by default (390x844 for the phone boards, 1280x800 for
  // Desktop, 1280x900–1600 for the staff and mod boards), so the page is shot at the reference's size.
  const viewport = o.viewport ?? boardViewport(board, o.boardsDir);
  const [width, height] = viewport.split('x').map(Number) as [number, number];
  const now = page.viewportSize();
  if (now?.width !== width || now.height !== height) {
    await page.setViewportSize({ width, height });
    // Let the responsive shell re-render at the new width before anything is measured or shot.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }
  const masks = o.masks ?? [];
  const refsDir = o.refsDir ?? `${BOARDS_DIR}refs`;
  const failures: string[] = [];

  // One page.evaluate, not locator.evaluateAll: evaluateAll finds the elements in one round trip and
  // runs the function in another, so a screen React swaps in between (a router navigation commits in a
  // transition, after the URL has changed) left it checking the old screen's detached button: found 0.
  const primaries = await page.evaluate(
    () =>
      [...document.querySelectorAll('[data-primary]')].filter((e) => e.checkVisibility({ visibilityProperty: true, opacityProperty: true })).length,
  );
  if (o.primary === false) {
    if (primaries !== 0) failures.push(`no [data-primary] on a board without a primary action, found ${primaries}`);
  } else if (primaries !== 1) {
    failures.push(`exactly one [data-primary], found ${primaries}`);
  }

  const scroll = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  if (scroll.wide > scroll.view) failures.push(`horizontal scroll: ${scroll.wide} px wide in a ${scroll.view} px viewport`);

  const transformed = await page
    .locator('[data-username]')
    .evaluateAll((els) =>
      els.map((e) => ({ name: e.textContent ?? '', t: getComputedStyle(e).textTransform })).filter((x) => x.t !== 'none'),
    );
  for (const x of transformed) failures.push(`text-transform ${x.t} on [data-username] "${x.name}"`);

  const texts = await boardTexts(page, board, o.boardsDir ? { boardsDir: o.boardsDir } : {});
  if (texts.length === 0) failures.push(`no board texts read for ${board}`);
  for (const t of await missingTexts(page, texts, masks)) failures.push(`board copy missing: "${t.replaceAll(MASK, '…')}"`);

  await reportPixels(page, board, viewport, masks, refsDir);

  if (failures.length > 0) throw new Error(`parity with board ${board} at ${viewport}:\n  - ${failures.join('\n  - ')}`);
}

/**
 * The reported, non-blocking screenshot comparison: the page against `refsDir`/<board>.png at
 * MAX_DIFF_PIXEL_RATIO, with [data-mask] regions and `masks` blacked out in both before the pixels
 * are counted. A missing or differently-sized reference, and a difference over the ratio, are
 * reported in the returned string (and pushed as a "parity-pixels" annotation); on a difference the
 * reference and the page are attached to the report. Never writes a reference. Returns the result.
 */
export async function reportPixels(
  page: Page,
  board: string,
  viewport: ParityViewport,
  masks: Locator[],
  refsDir: string,
): Promise<string> {
  const refPath = `${refsDir.replace(/\/$/, '')}/${board}.png`;
  let result: string;
  let actual: Buffer | undefined;
  let reference: Buffer | undefined;
  try {
    if (!existsSync(refPath)) throw new Error(`no reference refs/${board}.png (capture it with tools/parity/capture-refs.ts)`);
    reference = readFileSync(refPath);
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (const loc of [page.locator('[data-mask]'), ...masks]) {
      for (const r of await loc.evaluateAll((els) =>
        els.map((e) => {
          const b = e.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        }),
      )) {
        rects.push(r);
      }
    }
    actual = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
    const diff = await page.evaluate(
      async ({ refB64, actB64, rects }) => {
        const load = (b64: string) =>
          new Promise<HTMLImageElement>((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => rej(new Error('cannot decode a PNG'));
            img.src = `data:image/png;base64,${b64}`;
          });
        const [ref, act] = await Promise.all([load(refB64), load(actB64)]);
        if (ref.width !== act.width || ref.height !== act.height) {
          return { sizes: [ref.width, ref.height, act.width, act.height] as const };
        }
        const w = ref.width;
        const h = ref.height;
        const pixels = (img: HTMLImageElement): Uint8ClampedArray => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const cx = c.getContext('2d')!;
          cx.drawImage(img, 0, 0);
          cx.fillStyle = '#000';
          for (const r of rects) cx.fillRect(Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w), Math.ceil(r.h));
          return cx.getImageData(0, 0, w, h).data;
        };
        const a = pixels(ref);
        const b = pixels(act);
        let differing = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i]! - b[i]!) > 12 || Math.abs(a[i + 1]! - b[i + 1]!) > 12 || Math.abs(a[i + 2]! - b[i + 2]!) > 12 || Math.abs(a[i + 3]! - b[i + 3]!) > 12) {
            differing += 1;
          }
        }
        return { ratio: differing / (w * h) };
      },
      { refB64: reference.toString('base64'), actB64: actual.toString('base64'), rects },
    );
    if ('sizes' in diff) {
      result = `reported, not blocking: sizes differ (reference ${diff.sizes[0]}x${diff.sizes[1]}, page ${diff.sizes[2]}x${diff.sizes[3]})`;
    } else if (diff.ratio <= MAX_DIFF_PIXEL_RATIO) {
      result = `within ${MAX_DIFF_PIXEL_RATIO * 100}% of refs/${board}.png (${(diff.ratio * 100).toFixed(2)}% of pixels differ)`;
    } else {
      result = `reported, not blocking: ${(diff.ratio * 100).toFixed(2)}% of pixels differ from refs/${board}.png`;
    }
  } catch (e) {
    result = `reported, not blocking: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (result.startsWith('reported') && !result.includes('no reference')) {
    try {
      if (reference) await test.info().attach(`${board}-reference`, { body: reference, contentType: 'image/png' });
      if (actual) await test.info().attach(`${board}-page`, { body: actual, contentType: 'image/png' });
    } catch {
      // Attaching is best-effort (no running test info, say); the result still stands.
    }
  }
  test.info().annotations.push({ type: 'parity-pixels', description: `${board} ${viewport}: ${result}` });
  // The list reporter prints neither annotations nor attachments for a passing test: print the line
  // so a person sees it (the HTML report in playwright-report/ keeps the attached images).
  console.log(`parity-pixels ${board} ${viewport}: ${result}`);
  return result;
}

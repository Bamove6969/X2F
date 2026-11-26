# Spec · setup3 · lead items (5) and (7), 10 Nov

Boards: SetupBackup, SetupUsername, SetupWelcome, SetupPassword (SetupLogin checked, unchanged).
Source of truth for the app: origin/main d421706c, apps/web/src/screens/setup/*.tsx and setup.css.
All copy below is verbatim as on the boards. "COPY-UNSIGNED" = design wording the owner has not signed.

---

## 1. SetupBackup (setup step 4 of 5) · `canvas/project/SetupBackup.dc.html`

Reached from: SetupPgpChallenge "Continue" (PGP path) or SetupPassword "Set password" (password path).
Goes to: required view → "Show my recovery codes" → the codes, the tick and the type-back (RecoveryCode board) → back to this screen in the optional view → "Add …" or "Skip for now" → SetupWallet.
App: `Backup.tsx` (`saved === false` = required view, `saved === true` = optional view).

New tweak `view`: `required` (default) | `optional`. `pick` (optional view only) defaults to Security key.
The canvas `<title>` is now "Recovery codes and backups" (was "Add a backup login?").

Shared header (unchanged): Back (to SetupPgpChallenge), "Step 4 of 5", five bars (Username, Log in, PGP key, Backup, Wallet; 1-3 done in escrow, 4 current in ink), "Set up your account · Takes about 2 minutes."

### view: required (first view; owner S-017)
- H1: **Save your recovery codes** (COPY-UNSIGNED; same as main)
- Intro (16/24, ink-muted): "X2F has no email address or phone number for you, so if you lose your key or forget your password, a recovery code is your emergency way back in." (same as main)
- Escrow panel (shield icon, escrow 10% tint, 12px radius, 12×14 padding): "Your coins stay in your own wallet either way. Without a backup, you could lose this account and the reputation you've built on it, but you are never at risk of losing your funds."
  - **DIFFERENCE, kept the board's wording:** main ends at "…built on it." and drops ", but you are never at risk of losing your funds." (setup.spec.ts asserts the short text). Head designer to rule.
- Primary button in the content, 8px below the panel: **Show my recovery codes** (56px, monero, 18px/600). No footer, no "Skip for now" on this view (main: `footer={null}`).
- No choice list on this view.

### view: optional (after the codes are saved)
- H1: **Add another backup (optional)** (COPY-UNSIGNED; same as main)
- Intro: "A security key or a second PGP key also gets you back in. You can add one later in Settings." (same as main)
- No escrow panel.
- Radio cards (unchanged card style: 72px min height, 16px radius, selected = 2px ink border on surface-raised, ink dot; never orange), two only:
  1. **Security key** / "A YubiKey or similar that you keep somewhere safe." (selected by default)
  2. **Second PGP key** / "A spare PGP key stored separately from your main one."
  - Removed from the list: "Authenticator app" / "Six-digit codes from any authenticator app." and "Printed recovery codes" / "Ten one-time codes to print or write down." (no TOTP backup, build gaps Job 1; codes already made on the required view).
  - The board keeps its 40px icon tiles (key / PGP key); main's cards have no icon. Builder: add the icons if wanted, design prefers them.
- Footer: primary **Add security key** / **Add second PGP key** (pattern "Add {choice}"), then quiet link **Skip for now** (44px) → SetupWallet.

### Design notes (new section under the phone frame)
One "Decided · owner, 1 Nov (S-017)" aside: required first, optional after, panel only on the required view, no authenticator app, headings and intros COPY-UNSIGNED.

### Sizes
Phone frame is now content height per view: required **492**, optional **615** (was 937 for the old combined view). Notes **405**.
Default-variant height: **937 → 897** (492 + 405). Optional view: 1020.
$preview height 897.

### Parity
The optional view's blocks carry `hint-placeholder-val="{{true}}"`, the required view's `{{false}}`, so `boardTexts()` reads the optional view, which is the one setup.spec checks. The three SetupBackup KNOWN_EXCEPTIONS in parity.ts become stale except the panel's tail clause (see difference above): heading and intro now match.

---

## 2. SetupUsername (step 1) · `canvas/project/SetupUsername.dc.html`

Reached from: SignupSecurity / Terms. Goes to: display-name screen (main) / SetupLogin (board link).
Change: the rules line drops the public-name sentence "It shows exactly as you type it." It now reads:
"5 to 20 characters: letters, numbers, dots, dashes and underscores." (with 5 and 20 in mono)
The other old public-name text ("This is how traders see you. No email or phone number needed, now or ever.") was already gone from this canvas; the intro already reads "You type this to log in. Only you see it. Nobody can work it out from your display name. Nothing else to give us, now or ever." (same as main).
- **DIFFERENCE, kept the board's layout:** the board shows "Pick something that isn't your real name or used elsewhere." as its own info panel under the field card; main appends it to the help line ("5 to 20 characters: … underscores. Pick something that isn't your real name or used elsewhere."). Same words. Head designer to rule whether main should use the panel.
Height: unchanged (844). Pre-existing mismatch: content measures 664 against the fixed 844 (present before my edit, left as is).

---

## 3. SetupWelcome (end of setup) · `canvas/project/SetupWelcome.dc.html`

Change: the "Your setup" list's middle row now reads "Backup login" / **Recovery codes** (was "Authenticator app"); its icon is the printed-codes icon from SetupBackup (40px tile, same style). App: `Welcome.tsx` BACKUP_WORDS['recovery-codes'], `data-part="summary-backup"`.
Height: unchanged (852).

Main shows three lines the board does not have (not drawn, for the head designer):
- "Next, log in with what you just set up, to check it works." (only after a fresh sign-up; owner G25)
- "You pay X2F 1% of each completed trade from your own ads. Taking an offer is free." (OD-7, pending owner)
- main has no avatar row / "New" badge under the heading (the board does).
Also flagged: the board welcomes "juniper.oak", the same example used as the PRIVATE username on SetupUsername. Main welcomes the display name. Suggest a different example public name here.

---

## 4. SetupPassword (step 3, password path) · `canvas/project/SetupPassword.dc.html`

Reached from: SetupLogin "Continue with a password". Goes to: SetupBackup (required view).
The board had no strength meter; main has one (owner S-014). Added, in main's position: directly under the Password input, above "Type it again".

New tweak `meter`: `strong` (default) | `checking`.

Meter block (inside the Password field group, 4px below the input, `role="status" aria-live="polite"`, input `aria-describedby="pw-meter"`):
- Three bars in a 3-column grid, 4px gap, each 6px tall, pill radius.
- Line under the bars (14/20): "Strength: " in ink-muted, then the level word in 600 weight.
- Gap between bars, line and note: 6px.

| state | bars | level word | note under the line | leaked-list row |
|---|---|---|---|---|
| strong | 3 bars `var(--escrow)` | **Strong** in `var(--escrow)` | none | escrow tick: "Not on the list of leaked passwords" |
| checking | 3 bars `color-mix(in srgb, var(--line) 45%, transparent)` (neutral, no colour) | **Checking…** in `var(--ink-muted)` | "We're checking it hasn't appeared in a known leak." (13/18, ink-muted; no spinner) | empty ring icon (circle r=8, stroke 2) at 60% opacity, row text ink-muted: "Not on the list of leaked passwords" |

Exact copy (COPY-UNSIGNED, owner question p11-99 open):
- "Strength: Checking…" (single ellipsis character …)
- "We're checking it hasn't appeared in a known leak."
- "Strength: Strong"
Weak / Medium (main already has them; not drawn as tweaks here): "Strength: Weak" (1 bar, danger, word in danger), "Strength: Medium" (2 bars, ink-muted).
"Set password" stays enabled in both states (main: `canSet` allows checking).

Builder deltas against main:
- setup.css: `.x2f-start__meter[data-level='checking'] .x2f-start__meter-bar[data-on='true']` → `background: color-mix(in srgb, var(--x2f-line) 45%, transparent)` (main uses ink-muted). Bar height 6px (main 4px); 4px gap matches.
- Password.tsx StrengthMeter: add the note line when `level === 'checking'`; colour only the level word, "Strength:" stays ink-muted.
- Rule `leaked` with `met='unknown'`: show an empty ring, not a tick (main shows a 60%-opacity tick, which reads as "passed").
- **Truth problem to fix or reword:** main checks the leaked list only when "Set password" is tapped (setLeaked('true') is never called before). So "We're checking…" would show while nothing is being checked, and Strong is never reached on this screen. Either the app checks the leaked list as you type (debounced call), or the note becomes "We'll check it hasn't appeared in a known leak when you set it." Head designer / lead to choose.

Design notes (new section under the frame): "Decided · owner, 1 Nov (S-014)" aside (meter levels, checking state, leaked → Weak, same state on SignupSecurity) and "OPEN · owner, p11-99" aside (checking wording COPY-UNSIGNED).

Sizes: frame strong **953**, checking **977** (was 909; +44 meter, +24 note). Notes **501**.
Default-variant height **909 → 1454**. Checking: 1478. $preview 1454.

Not mine: SignupSecurity needs the same `checking` meter state (its meter tweak is weak/medium/strong).

Other main differences on this board (not changed):
- Board's caution panel "No reset without your help" + "X2F stores a scrambled version that can't be turned back into your password. We have no way to reset it for you, so keep it in a password manager or somewhere else safe." Main has no heading and says "…We have no email address to reset it with, so keep it…". Board wording kept (clearer that nobody can reset it); for ruling.
- Checklist aria-label: board "Password checks", main "Password rules".

---

## 5. SetupLogin (step 2) · unchanged

Differences with main, for the head designer:
- PGP description: board "…so there is no password for a hacker to compromise from us."; main "…so there is no password for anyone to steal from us." Main's is plainer; suggest the board adopts it.
- Board "New to PGP? See the FAQ for recommended PGP apps." (link line); main has a "New to PGP?" button that opens an inline explainer: "PGP is free software that locks and unlocks messages with a pair of keys: a public key you can share and a private key only you keep. You need a PGP app each time you log in, such as Kleopatra on Windows, GPG Suite on a Mac or OpenKeychain on Android. X2F never makes keys for you, so your private key never leaves your app."

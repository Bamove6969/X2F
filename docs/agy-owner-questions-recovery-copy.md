# Owner & Lead Questions — Recovery Code (`wip/agy-recovery-copy`, 12 Nov Notes #28 & #29)

This document covers the singular `"recovery code"` wording audit across `apps/web/src` and the design/security questions for the owner and lead on **12 Nov Note #28 (`9459c095`)** and **12 Nov Note #29 (`6b15edc1`)**.

---

## Part 1: Singular `"recovery code"` Wording Status (`apps/web/src` vs Auth/API Scope)

### Updated in `wip/agy-recovery-copy` (`apps/web/src`)
- **`apps/web/src/screens/settings/Methods.tsx:40,159`:**
  - `LABELS['recovery-codes']`: `'Recovery codes'` → `'Recovery code'` (matching `apps/web/src/screens/settings/holdCopy.ts:26`).
  - Action button (`[data-add="recovery-codes"]`): `'Create recovery codes'` → `'Create recovery code'`.
- **`apps/web/src/screens/settings/RecoveryCodes.tsx:29,38,48,62`:**
  - Error fallback: `'Could not make recovery codes. Try again.'` → `'Could not make your recovery code. Try again.'` (matching `apps/web/src/screens/setup/Backup.tsx:113`).
  - Note: `'Save these now. Each works once, and you will not see them again.'` → `'Save this now. It works once, and you will not see it again.'`
  - Done button (`[data-part="recovery-done"]`): `'I have saved them'` → `'I have saved it'`.
  - Reveal button (`[data-part="recovery-make"]`): `'Show my recovery codes'` → `'Show my recovery code'` (matching `apps/web/src/screens/setup/Backup.tsx:125`).

### Already Singular on `origin/wip/third-demo-r3`
- **`apps/web/src/screens/setup/Backup.tsx:51-54,113,125,135,141,151,178,205,216`** (`/setup/backup`): Uses singular `"recovery code"` / `"it"` throughout (`"Save your recovery code"`, `"Show my recovery code"`, `"Type your recovery code from what you wrote down"`, `"That matches your recovery code."`, `"Back to my code"`).
- **`apps/web/src/screens/setup/Welcome.tsx:36`** (`/setup/welcome`): `"Emergency login method: recovery code documented"`.
- **`apps/web/src/screens/auth/BackupLogin.tsx:88`** (`/login/backup`): `"A recovery code"`.
- **`apps/web/src/screens/settings/holdCopy.ts:26,48,185-208`** and **`apps/web/src/screens/settings/Alerts.tsx:48,90`**: Uses singular `"Recovery code"` / `"Your recovery code"` throughout.

### Remaining Plural Strings Outside `apps/web/src` (Claude Auth/API Scope or Owner-Authored Plural Copy)
1. **`packages/accounts/src/confirmAction.ts:100`** (`describeAction({ kind: 'new-recovery-codes' })`):
   - Currently returns `'make new recovery codes'`, which renders inside `ConfirmSheet` (`apps/web/src/screens/auth/ConfirmSheet.tsx:102`) as `"To make new recovery codes, confirm it's you."`
   - **Lead/Claude action:** Change `'make new recovery codes'` → `'make a new recovery code'` in `packages/accounts/src/confirmAction.ts:100` (and update `packages/accounts/test/confirmAction.test.ts:14`, `packages/auth-client/test/flows.test.ts:273`, and `apps/web/test/task30-units.test.tsx:99`).
2. **`apps/api/src/auth/methods.ts:211,254`** (`GET /v1/account/methods`):
   - `const RECOVERY_LABEL = 'Recovery codes';` and `label: `${RECOVERY_LABEL} (${rcRow.unused} left)`` send `"Recovery codes (1 left)"` from the API.
   - **Lead/Claude action:** Change `RECOVERY_LABEL` in `apps/api/src/auth/methods.ts:211` to `'Recovery code'` (and consider whether `(1 left)` should be omitted when `RECOVERY_CODE_COUNT === 1`).
3. **`apps/web/src/screens/setup/termsText.ts:76`** (`/setup` Terms Section 2):
   - Reads `"Keep your login details and recovery codes safe and private."` — this is the owner's verbatim sentence from 13 Nov note #4 (`ce105e5c`), speaking to traders collectively, and is left untouched.

---

## Part 2: Ask 1 — 4× Longer Recovery Code, Auto-Dashes & Storage (`12 Nov #28`, `9459c095`)

> **Owner note #28 (`9459c095` on `/setup/backup`):**
> *"It should say recovery code not codes because it only gives them one so speak of it in the singular perspective and it should be much longer, like the times that length and our system needs to be a fortress that keeps those matched to an account an encrypted except when they are used even if it takes the system a few minutes to locate their encrypted code, decrypt it, and match it to what they typed in. Dashes will be typed in automatically which goes for both typing and pasting."*

### Current State on `origin/wip/third-demo-r3`
- **4× length (64 symbols, 16 groups of 4, 320 bits):** Implemented in `packages/accounts/src/loginCode.ts:23,73-84` (`RECOVERY_CODE_LENGTH = 64`, up from 16 Crockford base32 symbols; legacy 16-symbol codes still normalize via `OLD_RECOVERY_CODE_LENGTH = 16`).
- **Auto-dashes on type and paste:** Implemented in `packages/accounts/src/loginCode.ts:92-95` (`formatRecoveryInput`), wired into `#recovery-typeback` on `/setup/backup` (`apps/web/src/screens/setup/Backup.tsx:189`).
- **Account-bound storage:** Implemented in `apps/api/src/auth/recovery.ts:59,66-70` (`RECOVERY_CODE_COUNT = 1`; stored only as `HMAC-SHA-256(key, "x2f/recovery-code\0" + accountId + "\0" + normalized)` under `X2F_RECOVERY_CODE_KEYS`, never in plaintext, with auto-replaced codes after a backup login sealed via AEAD in `recovery_code_reveals` at `recovery.ts:297-308`).

### Open Owner / Lead Questions on Ask 1

#### Question 1A: Auto-dashes (`formatRecoveryInput`) on `/login/backup` and Settings password-change recovery-code inputs
- **Where:**
  - `apps/web/src/screens/setup/Backup.tsx:189` (`#recovery-typeback`) already applies `formatRecoveryInput(e.target.value)` so dashes are inserted automatically on typing and pasting.
  - However, `apps/web/src/screens/auth/BackupLogin.tsx:90` (`#backup-code` on `/login/backup`) and `apps/web/src/screens/settings/Methods.tsx:242` (`#password-recovery-code` in Security Settings) still use raw `onChange={(e) => setCode(e.target.value)}` without `formatRecoveryInput`.
- **Options:**
  - **Option A (Recommended):** Apply `formatRecoveryInput` to `#backup-code` in `BackupLogin.tsx:90` and `#password-recovery-code` in `Methods.tsx:242` so dashes are inserted automatically when typing or pasting a recovery code on every screen, not just `/setup/backup`.
  - **Option B:** Keep `formatRecoveryInput` only on `/setup/backup`.
- **What each changes:** Updates `onChange` in `BackupLogin.tsx:90` and `Methods.tsx:242` to call `formatRecoveryInput` from `@x2f/auth-client`.

#### Question 1B: One-way keyed HMAC vs slow KDF / AEAD storage (`apps/api/src/auth/recovery.ts`)
- **Context:** In note #28, the owner wrote: *"our system needs to be a fortress that keeps those matched to an account an encrypted except when they are used even if it takes the system a few minutes to locate their encrypted code, decrypt it, and match it to what they typed in."*
- **Current implementation:** `apps/api/src/auth/recovery.ts:66-70` stores a one-way account-bound keyed hash (`HMAC-SHA-256` under `X2F_RECOVERY_CODE_KEYS` with domain separation `x2f/recovery-code\0${accountId}\0${normalized}`). Because the code has 320 bits of CSPRNG entropy and the server never needs to decrypt an existing code back to plaintext (it only hashes the user's input and compares digests), one-way HMAC is strictly stronger than reversible encryption because the plaintext is never stored. If slow verification is also desired to match the owner's note, wrapping the hash with Argon2id would prevent fast offline verification even after a full database and key compromise.
- **Options for Owner / Lead:**
  - **Option A (Current):** Keep the account-bound `HMAC-SHA-256` over the 320-bit code (`recovery.ts:66-70`).
  - **Option B:** Add an intentionally slow memory-hard KDF (e.g., Argon2id) inside `recoveryCodeHash` before or after the keyed HMAC if slow verification is desired alongside the 320-bit code.

---

## Part 3: Ask 2 — Test-After-Writing-Down Flow (`12 Nov #29`, `6b15edc1`)

> **Owner note #29 (`6b15edc1` on `/setup/backup`):**
> *"They check the box to say they've written it down. Then they click next and on the next screen or tests them on whether they actually wrote down the code. There is no point in testing them when they can see the code, we want to strongly encourage writing it down. If they get it wrong on the next screen it will turn read until it's typed in correctly and then it will turn green and let them move onto the next screen. If they cannot get it right they will have a back button where they can go back to this screen and actually write down the code and this time hit next and get it right on the following screen. If they hit back their code will be the same, it's their unique code and it will not change unless they end up using it or they request a new one in security settings."*

### Current State on `origin/wip/third-demo-r3`
- **On `/setup/backup` (`apps/web/src/screens/setup/Backup.tsx:131-221`):**
  - **Screen A (`data-screen-part="show"`):** Displays the 64-symbol recovery code in 16 four-character groups (`<ol className="x2f-codes x2f-codes--long">`), the `"I've written it down"` checkbox (`[data-part="recovery-written"]`), and a `Next` button (`[data-part="recovery-next"]`, disabled until the checkbox is ticked).
  - **Screen B (`data-screen-part="test"`):** Hides the recovery code completely and shows `#recovery-typeback` (`"Type your recovery code from what you wrote down"`). While typing/pasting, `data-match` is `"no"` (red border + `"Not a match yet. Check what you wrote down."`) until `normalizeRecoveryCode(typed) === normalizeRecoveryCode(code)`, when `data-match` turns `"yes"` (green border + `"That matches your recovery code."`) and `Next` (`[data-part="recovery-continue"]`) enables.
  - **`Back to my code` (`[data-part="recovery-back"]`):** Returns to Screen A with the exact same `code` preserved in `SetupState.recoveryCode` (`apps/web/src/screens/setup/kit.tsx:60`).

### Open Owner / Lead Questions on Ask 2

#### Question 2A: Should Security Settings (`RecoveryCodes.tsx` and `HoldChanges.tsx` new-code reveal) also use the two-screen type-back test?
- **Where:**
  - `/setup/backup` (`apps/web/src/screens/setup/Backup.tsx:80-221`) uses `RecoveryCodeStep` (Screen A: show + checkbox + `Next` → Screen B: unseen type-back + red/green state + `Back to my code`).
  - However, when a signed-in trader creates a replacement recovery code in **Security Settings** (`apps/web/src/screens/settings/RecoveryCodes.tsx:35-52`), it still uses the older single-screen view: an ungrouped `<ul className="x2f-codes">` and a single `"I have saved it"` button with no checkbox and no Screen B type-back check.
  - Similarly, when a trader reveals an auto-renewed recovery code after a backup login (`apps/web/src/screens/settings/HoldChanges.tsx:466-535`), it shows a checkbox (`"I've written it down"`) and `"Done"` without a Screen B type-back check.
- **Options:**
  - **Option A:** Share `Backup.tsx`'s two-screen flow (4-character grouped `<ol className="x2f-codes x2f-codes--long">`, `"I've written it down"` checkbox + `Next`, then unseen Screen B type-back with red/green match and `Back to my code`) in `RecoveryCodes.tsx` (and optionally `HoldChanges.tsx`).
  - **Option B (Current):** Require the two-screen type-back test only during initial account setup on `/setup/backup`, and keep Settings lightweight (`"I have saved it"`).
- **What each changes:** Updates `apps/web/src/screens/settings/RecoveryCodes.tsx` (and `apps/web/e2e/security.spec.ts:69-83,131-141,243-254`) to use the grouped display and two-screen type-back flow.

#### Question 2B: Full 64-symbol type-back vs partial / group verification on Screen B
- **Context:** Now that the recovery code is 64 symbols (16 groups of 4, e.g., `ABCD-EFGH-...`), Screen B (`Backup.tsx:168-194`) requires typing (or pasting) all 64 symbols before `matches` becomes `true`.
- **Options:**
  - **Option A (Current):** Require typing/pasting the full 64-symbol recovery code on Screen B (strictest proof that every group was written down).
  - **Option B:** Ask for specific groups (e.g., 3–4 randomly chosen 4-character groups by group number) if typing all 64 characters on a phone keyboard is too long.
- **What each changes:** Changes `RecoveryCodeStep` in `apps/web/src/screens/setup/Backup.tsx:168-220` and `apps/web/test/signupRecoveryCode.test.tsx`.

#### Question 2C: Server-side vs client-side confirmation of the type-back step
- **Context:** When the user clicks `Show my recovery code` on `/setup/backup`, `POST /v1/account/recovery-codes` (`apps/api/src/auth/recovery.ts:106-135`) immediately stores the hash in `recovery_codes`. If the user reloads the tab before completing Screen B, `SignupBackupGate` (`apps/web/src/screens/setup/signupPending.ts:11-60`) redirects them back to `/setup/backup`, where a fresh code is generated and replaces the unverified one (`Backup.tsx:19-21`). However, if the user closes the browser altogether after Screen A, the server database already has a `recovery_codes` row for the account (`hasBackup: true`).
- **Options:**
  - **Option A (Current):** Keep verification in the browser (`Backup.tsx` + `SignupBackupGate` in `signupPending.ts`) so the plaintext code is never sent back over the network a second time.
  - **Option B:** Mark newly generated recovery codes as unconfirmed in the DB until a confirm endpoint is called after Screen B passes.
- **What each changes:** Option B would require a migration and endpoint change in `apps/api/src/auth/recovery.ts` (Claude's scope).

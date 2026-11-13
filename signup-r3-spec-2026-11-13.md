# Signup round 3: owner's comments of 12–13 Nov, with lead calls

Source: `owner-demo-notes-2026-11-13.jsonl`. This work starts only after signup-v2 lands (R1 and the m-2 blocking fix). All copy is COPY-UNSIGNED; design reviews it.

## Behaviour
1. **TOTP without a password.** Today the authenticator option unlocks only after a password is chosen.
   - Lead call: TOTP may be chosen as the only extra method when PGP, a passkey or a security key is also chosen.
   - With none of those, keep today's rule: TOTP needs a password.
   - Check the server's method rules agree, and change them if they don't.
2. **Display names and usernames.** The owner tried `$` and was refused. He wants most common characters allowed, "just not weird ones that might trip up the system".
   - Lead call, display name: allow printable Unicode letters, digits, spaces and common punctuation and symbols (`$ & ! ? . , ' - _ @ # % * + ( ) :`). Refuse control characters, zero-width and bidi-override characters, and characters that change the text's direction.
   - Normalise to NFC, trim, and collapse runs of spaces. Keep the length limit.
   - Usernames keep a stricter set, because they appear in links and mentions: letters, digits, `_`, `-` and `.`. Add `$` only if impersonation checks still hold. Report what you choose.
   - The confusables and impersonation checks still apply to both.
3. **Password field.** Add a show/hide eye button to each password field. Hidden is the default. The button is 44 px and has an accessible label.
4. **Authenticator success.** After the 6-digit code verifies, show a green "You have successfully set up your one-time password." state before moving on. Today the screen just disappears.
5. **Password managers.** The owner uses 1Password and can't scan the QR code on the same phone.
   - Add an `otpauth://totp/...` link, "Add to your authenticator or password manager". On a phone it opens the authenticator app or password manager that handles the link.
   - Keep the copyable secret, with grouping and a copy button.
   - Don't put the secret anywhere it could be logged.
6. **PGP key facts.** On /setup/pgp-key, show the key's user ID name, if it has one, next to the fingerprint and algorithm. Never show the email address: strip the `<…>` part.
   - Also show the key's creation date and expiry, if they're available.
   - This shows only to the user themself. Don't store anything new.
7. **Android PGP app.** Recommend PGPony first (F-Droid package `com.pgpony.android`) and OpenKeychain second.

## Wording (COPY-UNSIGNED)
- /setup/login lead: "Anything you don't set up now can be added later. The more options you choose, the more secure your account becomes."
- PGP choice description: "Only you can unlock it. Decrypt the enclosed message with your preferred PGP app to reveal a one-time login code, which proves you hold the matching private key. Only the holder of that key can see the code, and each code works only once."
- Security key choice description: "…by tapping or inserting your YubiKey, Google Titan, Nitrokey, Feitian or any FIDO2-certified security key into your phone or computer."
- /setup/pgp-key header title: "Adding your public PGP key", instead of "Create account".
- /setup/backup lead: "…so if you ever lose access to your login methods, your emergency recovery code is the only way back into your account to set up new security."

## Layout
- Fonts are still too small on /setup/login, /setup/pgp-key and the /setup/backup panel. Go one step bigger again for body text on the setup screens. The owner accepts more scrolling.
- Make the recovery-code reveal button's label bigger and wider so it fills the button.
- /setup/security-key: fill the empty space with an illustration of 4–5 generic security keys of different shapes: USB-A, USB-C, NFC card style, Lightning. Use no brand logos or trademarks; name the brands in text only. Design draws it; put in a placeholder until then.
- /setup/authenticator: a larger QR code, plus an OTP illustration. The owner later said "It looks good now", so this is low priority; let design decide.

## Already in progress elsewhere
- The back-swipe skip of the recovery check is the m-2 blocking fix on signup-v2.
- "Unable to add security key (USB and NFC)" is being debugged; see debug-security-key-2026-11-13.md.

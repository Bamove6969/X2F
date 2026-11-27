-- Owner, 27 Nov 2026 (Jess, 01:04 UTC): a trader logs in with their private login name and their
-- authenticator app's code ("Ours will just be a user ID and otp because user ID is secret"). Such
-- a login from a new browser waits for approval on a logged-in device like any other, so an
-- approval may now carry the method `totp`. Confirms never do (confirm_tokens is unchanged).
alter table login_approvals drop constraint if exists login_approvals_method_check;
alter table login_approvals add constraint login_approvals_method_check check (method in ('pgp', 'passkey', 'security-key', 'totp'));

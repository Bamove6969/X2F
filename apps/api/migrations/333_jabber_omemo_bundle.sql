-- OMEMO for the Jabber sender (owner ruling p11-31; docs/jabber/omemo-plan.md): X2F's own OMEMO 0.3
-- bundle (a signed prekey, its XEdDSA signature and 100 one-time prekeys, jabber/omemo.ts), created
-- once on first use next to the identity key it is signed under, and stored sealed under
-- X2F_JABBER_KEYS (bound to `x2f/jabber-omemo-bundle/<identity public key hex>`). Published to the
-- sending account's PEP nodes on every connection. 333: next after 332; re-check the number at landing.
alter table jabber_omemo_identity add column bundle_sealed bytea;

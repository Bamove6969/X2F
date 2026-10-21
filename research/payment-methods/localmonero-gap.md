# LocalMonero payment methods vs the X2F catalog: the gap

**Date checked:** 2026-10-21 · **Our catalog:** `data/payment-methods.json` (79 entries) · **Research only:** nothing in the catalog was changed.

(Work in progress: sources and counts first; the tables follow in the next commit.)

## 1. Sources

**The Wayback Machine could not be used.** Every request to `web.archive.org` from this machine got HTTP 429 (Too Many Requests) all through the session. We retried for about 10 minutes. The availability API still answered and confirmed that snapshots exist, but we could not open them:

- LocalMonero home page, snapshot of 2024-04-30: `http://web.archive.org/web/20240430074847/https://localmonero.co/` (exists; not read)
- AgoraDesk API docs, snapshot of 2024-05-08: `http://web.archive.org/web/20240508104406/https://agoradesk.com/api-docs/v1` (exists; not read)
- No snapshot exists of the public method-list endpoints `localmonero.co/api/v1/payment_methods` or `agoradesk.com/api/v1/payment_methods`, according to the availability API.

**What we used instead (primary source): LocalMonero's own app source code.** LocalMonero and AgoraDesk shipped one open-source mobile app from a single code base. Its README says it holds "two apps under one code base". Repository: https://github.com/AgoraDesk-LocalMonero/agoradesk-app-foss. Last commit `c11ba0c`, dated 2024-05-28. That is 3 weeks after the wind-down began on 2024-05-07, and LocalMonero shut down on 2024-11-07 ([AlternativeTo](https://alternativeto.net/software/local-monero/about)). Two files in it name the payment methods:

1. `lib/core/translations/payment_method_mixin.dart` ([link](https://github.com/AgoraDesk-LocalMonero/agoradesk-app-foss/blob/c11ba0cfc2905b7ba884eeb957bd2120b529e400/lib/core/translations/payment_method_mixin.dart)) maps 110 method codes to display names. English names for the generic codes come from `assets/translations/app_en.arb`.
2. `assets/banks/` ([link](https://github.com/AgoraDesk-LocalMonero/agoradesk-app-foss/tree/c11ba0cfc2905b7ba884eeb957bd2120b529e400/assets/banks)) holds 112 icons, one per method code. Ten codes have an icon but no entry in the name map: AFRIEX, AIRTM, CHIME, GOLDBACK, IDEAL, NEOSURF, SOFI_P2P, TWINT, UPI and ZEN. They are almost certainly methods added late, whose names came from the server.

**Caveat.** The app downloaded the live list from the API at run time (`ads_service.dart` calls `/payment_methods`). So the two files above are a **lower bound** on what LocalMonero offered. A method that existed only on the server, with no icon and no name in the app, would not appear here. We think few were missed, because the icons cover even small methods (PYC, Superflash), but this is **unconfirmed** until someone can read a 2023–24 Wayback snapshot of the buy page's method filter. AgoraDesk used the same list; this app serves both brands, so it doubles as the AgoraDesk cross-check.

**How we counted.** We merged the name map and the icon set. We dropped 5 codes that are not methods or are duplicates: `any_payment_method`, `ALL_ONLINE` (filters), `FACEBOOK` (an icon duplicate of FACEBOOK_PAY), "Skrill (Moneybookers)" (an icon duplicate of MONEYBOOKERS) and `KAOSHI_NETWORK` (an icon duplicate of KAOSHI). That leaves **118 distinct LocalMonero methods**.

Status checks for providers (still operating?) come from web searches on 2026-10-21 and from fetching each provider's home page with curl the same day. "Site live" means the provider's own domain answered HTTP 200 or 403 (403 = blocked our bot, site exists). A live site does not prove that the P2P feature still works. Those rows are marked "(site live only)".

## 2. Summary counts

| | Count |
|---|---|
| LocalMonero methods (distinct, lower bound) | **118** |
| Matched to an X2F entry | **53**: 46 direct, 7 via a generic or near entry |
| Missing from X2F | **65**: 8 are gift-card codes |
| X2F entries with no LocalMonero counterpart ("ours, not theirs") | **36** of 79 |

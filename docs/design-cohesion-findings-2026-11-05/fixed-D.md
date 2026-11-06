# Fixed D (5 Nov, resumed run)

## Boards changed
- DisputeOpen: already fixed by the killed run (danger "Opening a dispute" chip + key mark, reason moved into the lead, "Not now", textarea in Atkinson, "within 4 h", root/$preview 1485). Verified: check OK, night/day rendered, nothing clipped.
- DisputeRoom: already fixed by the killed run (primary "Send unblurred proof to sarah.v" pinned in the footer above the composer, request card kept as a --mod callout, "ruling due by 30 Oct 2026, 10:14 UTC (in 23 h)" date format). Verified: check OK, night/day rendered.
- DisputeRuling: hero now matches Appeal-Notice (chip "Dispute decided" + key mark row, label "Release to the buyer", headline "The 1.250000 XMR goes to you", moderator block with "29 Oct 2026, 14:05 UTC"); appeal card keeps only the caution timer chip ("47 h 40 min left") and says "until 31 Oct 2026, 14:05 UTC" / "a senior moderator who hasn't seen this case"; pinned footer with primary "File appeal" (closed mode) + tertiary "Back to my trades"; "Evidence used" rows now 40px --surface icon tiles, min-height 64; appeal textarea in Atkinson; sent callout "A senior moderator will look at it."; heights closed 1250 / writing 1392 / sent 1312, $preview 1250.
- Lien-Notice: headline "Trading paused until you repay mira.k"; amount moved into a --surface-raised "You owe" block (mono 28/32 + XMR unit + fiat); "(appeal decision)" moved into the lead; appeal-decision card is now a plain --surface card with a neutral icon tile; "elena.t, senior moderator" in ink 600 (dd flex 1, right-aligned); danger callout "If you don't repay, your account can be banned."; tertiary "Questions? Ask the team"; "proof the senior moderator can check"; heights 1325 / started 1471.
- Lien-Notice-Wide: same copy and card fixes; six-item nav rail (Trade current); amount block mono 32/36; height 854.
- Appeal-Notice: completed-trades list status "Appeal open until 31 Oct 2026, 14:05 UTC" (year added). Nothing else (findings said OK).
- Appeal-Notice-Wide: six-item nav rail (Trade current); back 44 + two-line context + Chat pill on one row at the top of the content column (margin-left -12); list status date with year. Heights unchanged.
- Ban-Notice: kept the sheet form (full-screen rewrite would be large); dropped the colons ("Ends", "Reason"); "reach out to the team on Matrix (or Telegram)"; site-ban rows "Message the team on Matrix" with example addresses #x2f-help:example.org / @x2f_help instead of "[... to come]"; design notes now carry two OPEN boxes: "Do bans have an end date?" (timed default kept) and the Matrix/Telegram addresses. Heights: app 844 / site 1269 / 1223 / 844 / 844, notes 377, $preview 1221.
- Ban-Notice-Wide: same copy fixes; six-item rail; same two OPEN boxes in a 2-column notes grid; notes 243, $preview 1043.
- Block: unchanged (OK). Block-Wide: six-item rail; Settings item is current on the settings view (new navSettings hole), Profile only on the profile view.
- TradeTechIssue: "Back to my trades"; "· Example" added to the header context; "message the team on Matrix or Telegram with this ID", "Contact the team on Matrix or Telegram with this incident ID:", "A team member decides how to go on."; example addresses in the Matrix/Telegram rows; the three in-app OPEN asides (incident ID format x2, held-account pop-up) moved below the root into Design notes; $preview 1927.
- TradeTechIssue-Wide: same copy and OPEN-box moves; six-item rail; $preview 1357.
- Alerts: chip "RECOMMENDED FOR DE-GOOGLED PHONES" replaced by a 13/18 muted lead "Recommended on phones without Google services."; "Play test sound" and "Send test" now full-width 48h secondaries; switches on = ink track / ground knob; $preview 2141.
- Alerts-Wide: rail copied verbatim from Devices-Wide (Settings current); same lead and ink switches; buttons stay auto width on wide.
- News: "Posts are examples." moved out of the app into a Design notes section under the app root (root height = app 844 + notes); $preview 939.
- News-Wide: same; six-item rail; $preview 895.
- Support: "Ask a team member"; lead "A team member will answer you here. Team members can't see dispute evidence or decide disputes, ..."; callout "... A team member will never ask for them."; primary "Send to the team"; chat badge "Team member" in --team; $preview 1281.
- Support-Wide: same; rail copied verbatim (Help current); $preview 992.
- Maintenance: 4-tab bottom bar removed (pinned footer is last); "Addresses are examples." moved to a Design notes section under the app root; $preview 939.
- Maintenance-Wide: caption moved to Design notes; six-item rail; $preview 895.
- SelfDestruct: hero (COMPLETED) is now the first card, the self-destruct callout follows it as a §12 info callout (--surface-raised + 30% ink-muted border); "· Example" added to the context line; $preview 854.
- SelfDestruct-Wide: same order; title now "Bought from satoshi_ghost" like the phone; rail copied verbatim; height 800.
- CantDoThat: unchanged (OK). CantDoThat-Wide: six-item rail (Post offer current); height unchanged.

## Findings skipped and why
- DisputeOpen "A moderator usually replies within 4 hours.": kept as "within <mono>4</mono> h" per the brief's owner list.
- DisputeRoom "ruling due by": deadline kept, only the date format fixed (brief).
- Ban-Notice full-screen rewrite (P2): skipped, sheet kept with the brief's permission; the OPEN box about timed bans is in the notes. Default `ends` tweak stays "date" (owner decision).
- Maintenance "The system has been taken down for unscheduled but necessary maintenance." (P3): left, possibly the owner's words (brief).
- Alerts toggle on-state (P3): applied as ink per shared standard 4 (not left for the lead).
- Lien-Notice "Decided by elena.t, senior moderator": applied; "Read the decision" link kept.

## COPY-UNSIGNED (new or changed user-facing sentences)
- DisputeRuling: "Dispute decided" · "Release to the buyer" · "The 1.250000 XMR goes to you" · "Either of you can appeal until 31 Oct 2026, 14:05 UTC (48 h). An appeal goes to a senior moderator who hasn't seen this case. ..." · "File appeal" · "Back to my trades" · "Appeal sent. A senior moderator will look at it. ..."
- Lien-Notice / -Wide: "Trading paused until you repay mira.k" · "An appeal decision on trade K7M2 went against you. The Monero network fee comes from your wallet." · "You owe" · "elena.t, senior moderator" · "If you don't repay, your account can be banned." · "Questions? Ask the team" · "The app records a payment proof the senior moderator can check."
- Ban-Notice / -Wide: "Ends" · "Reason" · "please reach out to the team on Matrix (or Telegram)." · "Message the team on Matrix"
- TradeTechIssue / -Wide: "Back to my trades" · "If you need us: message the team on Matrix or Telegram with this ID." · "Contact the team on Matrix or Telegram with this incident ID:" · "A team member decides how to go on."
- Alerts / -Wide: "Recommended on phones without Google services."
- Support / -Wide: "Ask a team member" · "A team member will answer you here. Team members can't see dispute evidence or decide disputes, so for a problem with a live trade, open a dispute from the trade instead." · "Never send a password, recovery code, authenticator code or private key. A team member will never ask for them." · "Send to the team" · badge "Team member"
- SelfDestruct-Wide: "Bought from satoshi_ghost"
- Appeal-Notice / -Wide: "Appeal open until 31 Oct 2026, 14:05 UTC"

## Open questions for the owner
- Do bans have an end date? (Ban-Notice OPEN box; default still shows "Ends 14 Nov 2026, 14:05 UTC".)
- Matrix and Telegram addresses (Ban-Notice, TradeTechIssue, Maintenance): #x2f-help:example.org and @x2f_help are examples.
- Incident ID format (TradeTechIssue): #K7M2Q9XA4FTR is an example of the #xxxxxxxxxxx model.
- Does the held account also get the incident-ID pop-up for a funded trade? (TradeTechIssue)
- Support: the old copy said helpers are "experienced traders who know X2F well"; dropped since team members are support staff. Confirm who answers tickets.
- Maintenance emergency copy ("unscheduled but necessary maintenance") left as possibly the owner's words.

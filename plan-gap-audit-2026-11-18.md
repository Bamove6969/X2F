# Plan vs built: gap audit (18 Nov, base wip/lead-land-tw 001959cc)
Plans 1 and 2: all built. Plan 3: built except T31 (regtest e2e trades), T32 (stagenet and load), T33 (review), T35 partly (quote method dropdown), T42 partly (member last-acted).

## Being built now (lead builders)
| Gap | Plan task | Branch |
|---|---|---|
| Review screens: after one trade, a trader cannot trade again | P5 T6 | wip/lead-review-screens |
| Profile route is dead; stats and profile | P5 T5, T12 | wip/lead-profile |
| Moderator chat and proof read; mod messages are dev-only | P4 T11 | wip/lead-mod-chat |
| Proof upload, blur and send | P5 T14 (trader side), T15 | wip/lead-proof-upload |
| Dispute purge, whole-trade self-destruct | P4 T23, P7 T1–3 | wip/lead-retention |
| Seller tx-proof, fees_owed, emergency stop on lists | P4 T12, T29 | wip/lead-ruling-compliance |
| Support tickets (unmerged since 10 Nov) | P4 T30–31 | wip/lead-support-tickets |
| Owner staff pages | P4 T17 | wip/lead-staff-owner-pages |
| Activity log page, training library | P4 T19 | wip/lead-staff-activity-log |
| Moderator performance | P4 T20 | wip/lead-staff-performance |
| FAQ / help library | P7 T10 (partly) | wip/lead-help-library |

## Still open (next wave)
- Trades list ("My trades"): the batch 10a trades-list covers the API; check the web screen.
- Lien repayment trade (P4 T25): waits on the owner's lien answers.
- Recommended account limits (P4 T26). Earnings from the fee wallet (P4 T9). Staff pay screens (P4 T33).
- OCR pipeline (P5 T13), smart proof card (P5 T16), review disputes and totals (P5 T19–20), the staff past-reputation screen (P5 T11).
- E2E: P3 T31, P4 T21, P5 T17. Security reviews: P3 T33, P4 T22, P5 T18.
- Plan 6 (launch infrastructure, hardening, native apps) and Plan 7 (privacy settings, delete account, public site, stats) are DRAFT and wait on the owner's approval.

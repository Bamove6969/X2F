# Wording sign-off pages (J-26)

Source: docs/copy-unsigned-by-screen.md on origin/wip/design-brief (8 Nov 2026). One page per batch; each question is one quoted line or a short group of quoted lines on one screen (batches 2 to 9 split to one line per question where a group ran long). Batch 01 also holds the re-asks G-014 (p5-5) and G-023 (page names).

| Batch | Screens | Questions |
|---|---|---|
| wording/batch-01 | 9 screens: SetupTerms, SignupSecurity, SetupUsername, SetupLogin, SetupPassword, SetupPgpKey, SetupPgpChallenge, SetupBackup, RecoveryCode | 59 (includes 9 re-ask questions) |
| wording/batch-02 | 9 screens: SetupWallet, SetupWelcome, Login, Login-Backup, LoginApprove, SessionLength, SessionExtend, RecoveryHold, Compromised | 100 |
| wording/batch-03 | 9 screens: InviteInvalid, MemberApproval, Main, BuyMain, BuyOffers, SellOffers, Fold-Offers (also Fold-TriFold), FlexOffer-Quote, BuyQuote | 52 |
| wording/batch-04 | 9 screens: Badges, OfferAd, PostOffer, FlexOffer-Post, GiftCardBrand, MyOffers, Fold-MyOffers, BecomeVendor, TradeFund | 98 |
| wording/batch-05 | 9 screens: BuyerPay, Desktop, Fold-Cover, ProofBlur, BuyerPaidWaiting, SellerConfirm, Warn-Release, SellerRefund, CancelRequest | 91 |
| wording/batch-06 | 9 screens: Refunded, Review, TradeTechIssue, SelfDestruct, Block, CantDoThat, DisputeOpen, DisputeRoom, DisputeRuling | 80 |
| wording/batch-07 | 8 screens: Appeal-Notice, Lien-Notice, Ban-Notice, HoldChange, Maintenance, Settings, Devices, Wallet | 128 |
| wording/batch-08 | 8 screens: Alerts, Profile, ProfileVisibility, BadgeSettings, Feedback, Team, MemberPermissions, TeamRefusal | 78 |
| wording/batch-09 | 8 screens: TeamChat, ModQueue, ModCase, StaffLog, StaffPerformance, StaffSettings, Support, FAQ | 94 |
| wording/batch-10 | 18 screens: TradeChat, SetupPassword, SetupBackup, FlexOffer-Post, MyOffers, BuyOffers, BuyQuote, DisputeRoom, SetupTerms, CancelRequest, BuyerPay, AccountFrozen, HoldChange, HoldMember, RecoveryCode, Alerts, Team, CantDoThat | 108 |
| wording/batch-11 | 41 screens: StaffLogin, StaffPgpProof, StaffKeyTap, StaffRefusals, StaffShell, StaffInvite, StaffOwnerSetup, StaffNews, StaffFeedback, BuyerPay, CancelFinalSheet, DisputeLocked, DisputeEntry, PaidConfirmSheet, ReleaseWarning, SellerConfirm, SellerCancelled, SellerCancelConfirm, SellerRefund, TradeFund, BuyerFundEnded, RefundedSlot, TradeGlance, SettleWait, DisputeOpen, DisputeRoom, DisputeScreen, DisputeRuling, DisputeRefusals, TradeChat, Landing, TradeStepper, JoinTeam, TeamMemberRoom, StaffBan, Maintenance, News, SessionExtend, IdleReminder, CantDoThat, MyOffers | 117 |
| wording/batch-12 | 23 screens: OfferCard, OfferList, MethodList, PostOffer, MyOffers, Badges, ProofCheck, Devices, AccountType, Block, Team, AuthRefusals, ApproveOnDevice, SessionLength, Feedback, PGP, PastReputation, CantDoThat, TradeChat, SellerConfirm, DisputeOpen, DisputeRoom, DisputeRuling | 76 |

Total: 1081 questions across 12 batches.

Batch 10's source is not the design-brief file: it is the COPY-UNSIGNED strings on the helper branches pay-details (J-08 chat payment-detail boxes), signup-rules (password meter, recovery codes), flex-offers (bands, currencies, no rate), trade-copy (trade room drop-ins, AccountFrozen, courtesy sheet), hold-v3-port (hold notices) and revenue-ledger (fee sweep alerts), as of 9 Nov 2026, less the strings already on batches 1 to 9.

Batch 11's source is the COPY-UNSIGNED strings on main (58f3d186, batch 3 landed) that are not on pages 1 to 10, as of 9 Nov 2026: the whole staff-web app (Login, Invite, OwnerSetup, NewsEditor, Feedback, StaffShell, PgpProof, KeyTapDialog, refusals), the batch 3 trade screens (BuyerPay's "Time to pay is over" and PayOverNote, CancelFinalSheet, DisputeLocked, SellerCancelled, SellerCancelConfirm, SellerConfirm, SellerRefund, TradeFund's buyer view, PaidConfirmSheet, ReleaseWarning, TradeGlance, settle wait), DisputeSlot and the dispute rules (p9-4), chat-shred-2's gap lines, the front-door Landing, teamCopy's JoinTeam, and the trader-side CantDoThat refusal texts, News, Maintenance and session words. Not yet on any page: the other files marked COPY-UNSIGNED (offer lists and cards, My offers model, offer form hints, badges and reviews, proof-check card lines, Devices, account type, block, auth refusals, ApproveOnDevice, old TEAM_COPY, PGP errors, past-reputation help); they are for a batch 12.

Batch 12's source is the COPY-UNSIGNED strings on main (58f3d186) that batch 11 left for it, less everything on pages 1 to 11 (checked line by line against their questions): offer cards, lists and amounts, the offer form's hints and errors, My offers' lines, badge words and review phrases, proof-check card lines, Devices, account type, block, Team's old TEAM_COPY, auth refusals, ApproveOnDevice's new-device lines, the rest of the session words, the web Feedback extras, PGP key errors and the login-code text, past-reputation help, the remaining hold, device and fallback texts of the can't-do-that popup, and a few trade chat and dispute lines that carry COPY-UNSIGNED and are on no page.

## Published 9 Nov 2026 (owner's links; answers in each page's db, collection `answers`, ids w0N-k)
- batch 1: https://claude.ai/artifact/VrpbfX9muKFJGvVvUSVnV8 (59)
- batch 2: https://claude.ai/artifact/Pm1edz8Dvywzhs5X3srY7i (100)
- batch 3: https://claude.ai/artifact/WbU4fyPWfNMStMVTaCUPt2 (52)
- batch 4: https://claude.ai/artifact/XtSbza6c9z7rAJyKq1Xiix (98)
- batch 5: https://claude.ai/artifact/AVMPH9F8w8q2uvzZREWBij (91)
- batch 6: https://claude.ai/artifact/51FVHKgtnCJ2SmA91ynDek (80)
- batch 7: https://claude.ai/artifact/WXX8NZbSjD83kv4kiuuL9i (127)
- batch 8: https://claude.ai/artifact/88sBS68UYjAFJHfn31XxXn (78)
- batch 9: https://claude.ai/artifact/NjwNvrNWCgJtmbAWS4ex24 (94)
- batch 10: https://claude.ai/artifact/DCEgkieSJHfgXPfKjyQDAL (108)
- batch 11: https://claude.ai/artifact/TiYPXbKfSoJLnpequbxpgk (117)
- batch 12: https://claude.ai/artifact/XGPPDkyhosXNGRfAVqYwQx (76)

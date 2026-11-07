# Lead review: fold follow-ups d9e97962, results 776fa4f1. Both CHANGES REQUIRED.
## Fold
- I1 Important: Q12 removed the "don't send any money" warnings while confirming. TradeGlance.tsx:55: glanceWarning only runs payBlock when glanceStep is 'pay', which now needs releasable. Lost: escrow-not-ready, no-amount, amount-differs, total-wrong, generic escrow-refused. Fix: gate line 55 on view.state === 'secured' && view.paidAt === null. Add the gate table with releasable: false.
- m1: m2 reopens after Back: OffersRoute.tsx:59, 64. Write the quote URL again if kept.amount exists, or clear the pane on Back.
- Owner rule Q12 says they cannot say paid until the escrow is fully funded. So the room follows too: the "Send exactly" card and "I've paid" stay off until releasable (fold.css:174, BuyerPay.tsx primary).
## Results
- I1 Important: PaidWaiting.tsx:175 "Your app co-signs by itself." is false: the co-sign runs in the open page (Released.tsx:59). Use: "When they release, X XMR goes to your wallet once your app co-signs. Keep this page open." Mark COPY-UNSIGNED, design confirms.
- m1: PaidWaiting.tsx:47-48, header comment, buyerPay.test.tsx:748-769 still say 30 minutes: owner Q10 and Q36 say 60. cap-dispute too. Fix the false "client follows the server's view" comment.
- m2: PaidWaiting.tsx:89, 122, 292 ignore pausedAt: the clock pauses in maintenance (Q10).
- m3: Refunded.tsx:186 "a moderator makes them send you the XMR" over-promises: design rewords.
- m4: TimerCard needs data-fold-glance: tabletop shows the timer twice.
Double bell closed. The two branches merge clean with each other and main.

# Job 8 (a11y): items for claude2 and the owner

Job 8 covers contrast, focus, labels and alt text only (owner order, to-agy.log 2026-11-16 22:44:41). Button sizes and font sizes belong to claude2 and the owner, so the items below were measured and are listed here, not changed. No recommendation is made.

## 1. Tap targets under 44 px on a side (base 94337781)

WCAG 2.2 2.5.5 (AAA) asks for 44 x 44 px; 2.5.8 (AA) asks for 24 x 24 px. The e2e phone check uses 32 px (apps/web/e2e/phone.ts MIN_TAP).

| Control | Where | Measured |
| :--- | :--- | :--- |
| `.x2f-app-chip` (wallet app chips) | Wallets.css:171 | 40 px tall |
| `.x2f-text-button` (inline text buttons on browse) | browse.css:364 | about 32 px tall |
| `.x2f-chip-button` | browse.css:161 | 44 px tall; width follows the label, no minimum |
| `.x2f-offer__nudge` | browse.css:658 | 44 px tall; no minimum width |
| `.x2f-quote__switch`, `.x2f-quote__max` | quote.css:130 | min 44 px tall; no minimum width |
| `.x2f-rail__home` (wide rail home link) | ui.css:632 | min 44 px tall; no minimum width |
| `.x2f-sync__retry` | sync-gate.css:29 | min 44 px tall; no minimum width |
| `.x2f-pay-timer__text` | pay.css:182 | no minimum size |
| `a.x2f-list__row` outside the Jabber alerts list | screens.css:266 | the 44 px minimum applies only to the Jabber rows |

Question for claude2 / the owner: should any of these grow to 44 px, and if so which? (Options: leave as drawn; raise only the height of the 40 px and 32 px ones; raise every listed control to 44 x 44.)

## 2. Trader text under the kit body size (18 px, tokens.css:88)

`apps/web/src` CSS sets a fixed `font-size` under 18 px in 369 places (count by size: 8 px 1, 9.5 px 1, 11 px 3, 12 px 3, 13 px 34, 14 px 96, 15 px 81, 16 px 63, 17 px 87). The kit's own label token is 15 px (`--x2f-label-size`) and the address token 16 px (`--x2f-address-size`). The full list (file, line, selector, px) is below. Nothing was changed; fonts and sizes are claude2's (owner 16 Nov fonts decision).

Question for claude2 / the owner: which of these, if any, should move up to the body size?

<details><summary>Full list</summary>

| File | Line | Selector | px |
| :--- | ---: | :--- | ---: |
| `fixtures/payChat.css` | 15 | `.x2f-board-chat__log` | 16 |
| `fixtures/payChat.css` | 21 | `.x2f-board-chat__notice` | 13 |
| `fixtures/payChat.css` | 55 | `.x2f-board-chat__input` | 16 |
| `fixtures/payChat.css` | 68 | `.x2f-board-chat__nudge, .x2f-board-chat__send` | 16 |
| `screens/Wallets.css` | 43 | `.x2f-wallets__intro` | 16 |
| `screens/Wallets.css` | 55 | `.x2f-wallets__section-label` | 14 |
| `screens/Wallets.css` | 98 | `.x2f-wallet-row__name` | 16 |
| `screens/Wallets.css` | 103 | `.x2f-wallet-row__addr` | 14 |
| `screens/Wallets.css` | 120 | `.x2f-wallet-row__word` | 14 |
| `screens/Wallets.css` | 133 | `.x2f-wallet-row__note` | 13 |
| `screens/Wallets.css` | 160 | `.x2f-wallets__add-hint` | 14 |
| `screens/Wallets.css` | 179 | `.x2f-app-chip` | 15 |
| `screens/Wallets.css` | 194 | `.x2f-wallets__tip` | 14 |
| `screens/Wallets.css` | 203 | `.x2f-wallets__field` | 14 |
| `screens/Wallets.css` | 222 | `.x2f-wallets__input` | 16 |
| `screens/Wallets.css` | 226 | `.x2f-wallets__confirm-note` | 13 |
| `screens/Wallets.css` | 233 | `.x2f-wallets__error` | 14 |
| `screens/Wallets.css` | 252 | `.x2f-wallets__escrow-text` | 14 |
| `screens/Wallets.css` | 276 | `.x2f-wallets__notice` | 14 |
| `screens/Wallets.css` | 298 | `.x2f-wallets__batch-item` | 15 |
| `screens/account/frozen.css` | 28 | `.x2f-frozen__page` | 16 |
| `screens/account/frozen.css` | 52 | `.x2f-frozen__facts dt` | 14 |
| `screens/account/frozen.css` | 59 | `.x2f-frozen__facts dd` | 16 |
| `screens/account/frozen.css` | 89 | `.x2f-frozen__list li` | 16 |
| `screens/auth/landing.css` | 56 | `.x2f-landing__promises li` | 16 |
| `screens/auth/landing.css` | 90 | `.x2f-landing__recover` | 16 |
| `screens/auth/landing.css` | 99 | `.x2f-landing__foot p` | 14 |
| `screens/browse/browse.css` | 80 | `.x2f-segment__tab` | 16 |
| `screens/browse/browse.css` | 119 | `.x2f-input` | 17 |
| `screens/browse/browse.css` | 154 | `.x2f-browse__sort-label` | 14 |
| `screens/browse/browse.css` | 173 | `.x2f-chip-button` | 15 |
| `screens/browse/browse.css` | 279 | `.x2f-method-pick__link .x2f-method__sub` | 15 |
| `screens/browse/browse.css` | 331 | `.x2f-method__name` | 17 |
| `screens/browse/browse.css` | 337 | `.x2f-method__sub` | 14 |
| `screens/browse/browse.css` | 345 | `.x2f-browse__empty, .x2f-browse__note` | 16 |
| `screens/browse/browse.css` | 359 | `.x2f-browse__footer` | 14 |
| `screens/browse/browse.css` | 414 | `.x2f-browse__head-sub` | 14 |
| `screens/browse/browse.css` | 420 | `.x2f-browse__muted` | 14 |
| `screens/browse/browse.css` | 438 | `.x2f-browse__market .x2f-browse__muted` | 15 |
| `screens/browse/browse.css` | 444 | `.x2f-browse__mono` | 16 |
| `screens/browse/browse.css` | 481 | `.x2f-offer__name` | 17 |
| `screens/browse/browse.css` | 505 | `.x2f-offer__sub, .x2f-offer__limits` | 14 |
| `screens/browse/browse.css` | 526 | `.x2f-browse__markup` | 15 |
| `screens/browse/browse.css` | 541 | `.x2f-browse__markup-text .x2f-browse__muted` | 14 |
| `screens/browse/browse.css` | 548 | `.x2f-browse__updated` | 14 |
| `screens/browse/browse.css` | 563 | `.x2f-offer__range` | 15 |
| `screens/browse/browse.css` | 575 | `.x2f-offer__unit` | 14 |
| `screens/browse/browse.css` | 610 | `.x2f-offer__more` | 13 |
| `screens/browse/browse.css` | 639 | `.x2f-offer__tip` | 14 |
| `screens/browse/browse.css` | 644 | `.x2f-offer__tip-title` | 13 |
| `screens/browse/browse.css` | 678 | `.x2f-offer__nudge` | 14 |
| `screens/browse/browse.css` | 708 | `.x2f-offer__time` | 14 |
| `screens/browse/browse.css` | 732 | `.x2f-offer__markup-label` | 13 |
| `screens/browse/browse.css` | 751 | `.x2f-offer__margin` | 16 |
| `screens/browse/browse.css` | 763 | `.x2f-offer .x2f-offer__action` | 17 |
| `screens/browse/browse.css` | 788 | `.x2f-offer__opens` | 17 |
| `screens/browse/browse.css` | 800 | `.x2f-suggest__label` | 16 |
| `screens/dispute/dispute.css` | 89 | `.dispute-lead, .dispute-muted` | 17 |
| `screens/dispute/dispute.css` | 93 | `.dispute-muted-sm` | 14 |
| `screens/dispute/dispute.css` | 98 | `.dispute-muted-14` | 15 |
| `screens/dispute/dispute.css` | 104 | `.dispute-body` | 17 |
| `screens/dispute/dispute.css` | 115 | `.dispute-strong-15, .dispute-strong-16` | 17 |
| `screens/dispute/dispute.css` | 126 | `.dispute-eyebrow` | 14 |
| `screens/dispute/dispute.css` | 140 | `.dispute-flag` | 14 |
| `screens/dispute/dispute.css` | 158 | `.dispute-wait` | 17 |
| `screens/dispute/dispute.css` | 176 | `.dispute-reasons legend` | 17 |
| `screens/dispute/dispute.css` | 188 | `.dispute-reason` | 17 |
| `screens/dispute/dispute.css` | 244 | `.dispute-textarea` | 17 |
| `screens/dispute/dispute.css` | 270 | `.dispute-included` | 14 |
| `screens/dispute/dispute.css` | 291 | `.dispute-notice` | 15 |
| `screens/dispute/dispute.css` | 299 | `.dispute-notice .dispute-muted` | 15 |
| `screens/dispute/dispute.css` | 327 | `.dispute-deadline` | 14 |
| `screens/dispute/dispute.css` | 344 | `.dispute-hero__label` | 14 |
| `screens/dispute/dispute.css` | 373 | `.dispute-hero__line` | 15 |
| `screens/dispute/dispute.css` | 378 | `.dispute-hero__meta` | 14 |
| `screens/dispute/dispute.css` | 394 | `.dispute-hero__amount-label` | 14 |
| `screens/dispute/dispute.css` | 412 | `.dispute-joined` | 15 |
| `screens/dispute/dispute.css` | 420 | `.dispute-joined .dispute-muted` | 15 |
| `screens/dispute/dispute.css` | 425 | `.dispute-cooperate` | 15 |
| `screens/dispute/dispute.css` | 459 | `.dispute-evidence-chip` | 14 |
| `screens/dispute/dispute.css` | 463 | `.dispute-chat-notice` | 13 |
| `screens/dispute/dispute.css` | 479 | `.dispute-system-card` | 14 |
| `screens/dispute/dispute.css` | 504 | `.dispute-outcome` | 14 |
| `screens/dispute/dispute.css` | 517 | `.dispute-evidence-list` | 15 |
| `screens/dispute/dispute.css` | 539 | `.dispute-appeal .dispute-muted` | 15 |
| `screens/dispute/dispute.css` | 550 | `.dispute-window-open, .dispute-appeal-sent` | 15 |
| `screens/dispute/dispute.css` | 560 | `.dispute-footnote` | 13 |
| `screens/dispute/dispute.css` | 576 | `.dispute-field-label` | 14 |
| `screens/dispute/dispute.css` | 589 | `.dispute-input-mono` | 15 |
| `screens/giftcard/giftcard.css` | 10 | `.x2f-giftcard-rules__hint` | 15 |
| `screens/giftcard/giftcard.css` | 30 | `.x2f-giftcard-rules__list--evidence > li` | 17 |
| `screens/post/PostOffer.css` | 106 | `.post-choices .x2f-chip-button` | 17 |
| `screens/post/PostOffer.css` | 163 | `.post-unit button` | 13 |
| `screens/post/PostOffer.css` | 172 | `.post-unit button[aria-checked='true']` | 16 |
| `screens/post/PostOffer.css` | 193 | `.post-mintrades .x2f-chip-button` | 16 |
| `screens/post/PostOffer.css` | 200 | `.post-field` | 14 |
| `screens/post/PostOffer.css` | 216 | `.post-load-failed` | 16 |
| `screens/post/PostOffer.css` | 227 | `.post-field select, .post-field input, .post-field textarea` | 17 |
| `screens/post/PostOffer.css` | 256 | `.post-error` | 15 |
| `screens/post/PostOffer.css` | 291 | `.post-muted, .post-note` | 14 |
| `screens/post/PostOffer.css` | 297 | `.post-card .post-note` | 15 |
| `screens/post/PostOffer.css` | 307 | `.post-giftcard` | 17 |
| `screens/post/PostOffer.css` | 353 | `.post-refusal` | 17 |
| `screens/quote/courtesy.css` | 11 | `.x2f-courtesy__text` | 17 |
| `screens/quote/courtesy.css` | 24 | `.x2f-courtesy__tick` | 16 |
| `screens/quote/quote.css` | 62 | `.x2f-quote__chat` | 16 |
| `screens/quote/quote.css` | 138 | `.x2f-quote__switch, .x2f-quote__max` | 16 |
| `screens/quote/quote.css` | 197 | `.x2f-quote__unit` | 17 |
| `screens/quote/quote.css` | 204 | `.x2f-quote__help` | 14 |
| `screens/quote/quote.css` | 293 | `.x2f-quote__wallet-name` | 17 |
| `screens/quote/quote.css` | 304 | `.x2f-quote__add` | 16 |
| `screens/quote/quote.css` | 320 | `.x2f-quote__figure > .x2f-quote__muted-sm` | 15 |
| `screens/quote/quote.css` | 435 | `.x2f-quote__band-label` | 14 |
| `screens/quote/quote.css` | 451 | `.x2f-quote__band-here` | 11 |
| `screens/quote/quote.css` | 459 | `.x2f-quote__band-rate` | 14 |
| `screens/quote/quote.css` | 466 | `.x2f-quote__band-rate .x2f-quote__mono` | 16 |
| `screens/quote/quote.css` | 472 | `.x2f-quote__band-range` | 16 |
| `screens/quote/quote.css` | 482 | `.x2f-quote__band-unit` | 14 |
| `screens/quote/quote.css` | 488 | `.x2f-quote__band-markup` | 13 |
| `screens/quote/quote.css` | 508 | `.x2f-quote__band-clip` | 15 |
| `screens/quote/quote.css` | 523 | `.x2f-quote__band-updated` | 14 |
| `screens/quote/quote.css` | 553 | `.x2f-quote__rows` | 15 |
| `screens/quote/quote.css` | 581 | `.x2f-quote__row--total` | 17 |
| `screens/quote/quote.css` | 600 | `.x2f-quote__muted-sm` | 14 |
| `screens/quote/quote.css` | 611 | `.x2f-quote__fine` | 14 |
| `screens/quote/quote.css` | 621 | `.x2f-quote__fine--center` | 14 |
| `screens/quote/quote.css` | 739 | `.x2f-wa__sub` | 14 |
| `screens/quote/quote.css` | 771 | `.x2f-wa__group-title` | 14 |
| `screens/quote/quote.css` | 781 | `.x2f-wa__count` | 14 |
| `screens/quote/quote.css` | 800 | `.x2f-wa__line` | 15 |
| `screens/quote/quote.css` | 831 | `.x2f-wa__toggle` | 16 |
| `screens/screens.css` | 79 | `.x2f-input` | 17 |
| `screens/screens.css` | 129 | `.x2f-textarea` | 14 |
| `screens/screens.css` | 146 | `.x2f-select` | 17 |
| `screens/screens.css` | 159 | `.x2f-pre` | 13 |
| `screens/screens.css` | 166 | `.x2f-note` | 14 |
| `screens/screens.css` | 192 | `.x2f-error` | 15 |
| `screens/screens.css` | 202 | `.x2f-secret` | 17 |
| `screens/screens.css` | 279 | `.x2f-list__time` | 13 |
| `screens/screens.css` | 311 | `.x2f-codes__item` | 15 |
| `screens/screens.css` | 346 | `.x2f-change__ba` | 15 |
| `screens/screens.css` | 360 | `.x2f-change__k` | 13 |
| `screens/screens.css` | 375 | `.x2f-changes-banner` | 15 |
| `screens/screens.css` | 399 | `[data-screen='maintenance'] .x2f-meta` | 14 |
| `screens/setup/setup.css` | 69 | `.x2f-start__title` | 16 |
| `screens/setup/setup.css` | 75 | `.x2f-start__step` | 14 |
| `screens/setup/setup.css` | 96 | `.x2f-start__time` | 14 |
| `screens/setup/setup.css` | 129 | `.x2f-start .x2f-label` | 15 |
| `screens/setup/setup.css` | 145 | `.x2f-start .x2f-textarea` | 14 |
| `screens/setup/setup.css` | 160 | `.x2f-start .x2f-textarea--key` | 13 |
| `screens/setup/setup.css` | 185 | `.x2f-start__match` | 15 |
| `screens/setup/setup.css` | 204 | `.x2f-start .x2f-codes--long .x2f-codes__item` | 17 |
| `screens/setup/setup.css` | 221 | `.x2f-start .x2f-pre` | 13 |
| `screens/setup/setup.css` | 230 | `.x2f-start__warn` | 14 |
| `screens/setup/setup.css` | 239 | `.x2f-start__panel` | 15 |
| `screens/setup/setup.css` | 251 | `.x2f-start__pill` | 15 |
| `screens/setup/setup.css` | 268 | `.x2f-start__foot .x2f-button--quiet` | 16 |
| `screens/setup/setup.css` | 293 | `.x2f-start__lead` | 17 |
| `screens/setup/setup.css` | 300 | `.x2f-start__help` | 15 |
| `screens/setup/setup.css` | 307 | `.x2f-start__small` | 14 |
| `screens/setup/setup.css` | 329 | `.x2f-start__textbutton` | 16 |
| `screens/setup/setup.css` | 353 | `.x2f-start__signing-title` | 16 |
| `screens/setup/setup.css` | 425 | `.x2f-start__strength` | 13 |
| `screens/setup/setup.css` | 459 | `.x2f-start__choice-name` | 17 |
| `screens/setup/setup.css` | 464 | `.x2f-start__option .x2f-start__choice-name` | 17 |
| `screens/setup/setup.css` | 468 | `.x2f-start__option .x2f-start__choice-desc` | 14 |
| `screens/setup/setup.css` | 477 | `.x2f-start__rec` | 13 |
| `screens/setup/setup.css` | 483 | `.x2f-start__choice-desc, .x2f-start__choice-later` | 15 |
| `screens/setup/setup.css` | 550 | `.x2f-start__chip` | 15 |
| `screens/setup/setup.css` | 565 | `.x2f-start__tip` | 14 |
| `screens/setup/setup.css` | 577 | `.x2f-start__facts` | 15 |
| `screens/setup/setup.css` | 582 | `.x2f-start__facts .x2f-start__small` | 14 |
| `screens/setup/setup.css` | 588 | `.x2f-start__mono` | 14 |
| `screens/setup/setup.css` | 614 | `.x2f-start__steps` | 16 |
| `screens/setup/setup.css` | 683 | `.x2f-start__rules` | 15 |
| `screens/setup/setup.css` | 710 | `.x2f-start__meter` | 15 |
| `screens/setup/setup.css` | 758 | `.x2f-terms__points` | 15 |
| `screens/setup/setup.css` | 767 | `.x2f-terms__hint` | 14 |
| `screens/setup/setup.css` | 783 | `.x2f-terms` | 16 |
| `screens/setup/setup.css` | 790 | `.x2f-terms__note` | 15 |
| `screens/setup/setup.css` | 799 | `.x2f-terms__heading` | 17 |
| `screens/setup/setup.css` | 821 | `.x2f-terms__end` | 14 |
| `screens/setup/setup.css` | 833 | `.x2f-check` | 16 |
| `screens/setup/setup.css` | 869 | `.x2f-sign__help` | 14 |
| `screens/setup/setup.css` | 906 | `.x2f-sign__here` | 13 |
| `screens/setup/setup.css` | 918 | `.x2f-sign__actions .x2f-start__textbutton` | 15 |
| `screens/setup/setup.css` | 978 | `.x2f-welcome__row` | 16 |
| `screens/setup/setup.css` | 1012 | `.x2f-welcome__check` | 17 |
| `screens/setup/setup.css` | 1068 | `.x2f-start__preview` | 15 |
| `screens/setup/setup.css` | 1077 | `.x2f-start__expires` | 15 |
| `screens/setup/setup.css` | 1098 | `.x2f-welcome .x2f-start__lead` | 17 |
| `screens/setup/setup.css` | 1123 | `.x2f-start:not([data-screen='setup-terms']) .x2f-start__help, .x2f-start:not([data-scre...` | 17 |
| `screens/setup/setup.css` | 1129 | `.x2f-start:not([data-screen='setup-terms']) .x2f-start__mono, .x2f-start:not([data-scre...` | 16 |
| `screens/setup/setup.css` | 1134 | `.x2f-start:not([data-screen='setup-terms']) .x2f-textarea--key` | 15 |
| `screens/setup/setup.css` | 1170 | `.x2f-keyart__caption` | 16 |
| `screens/trade/pay.css` | 61 | `.x2f-room__chat` | 16 |
| `screens/trade/pay.css` | 129 | `.x2f-escrow__bar-head` | 14 |
| `screens/trade/pay.css` | 166 | `:is(.x2f-pay, .x2f-room) .x2f-tip` | 15 |
| `screens/trade/pay.css` | 201 | `.x2f-pay-timer__label` | 14 |
| `screens/trade/pay.css` | 216 | `.x2f-pay-timer__hint` | 14 |
| `screens/trade/pay.css` | 256 | `.x2f-pay-card__currency` | 17 |
| `screens/trade/pay.css` | 264 | `.x2f-pay-card__rows` | 15 |
| `screens/trade/pay.css` | 282 | `.x2f-pay-card__note` | 15 |
| `screens/trade/pay.css` | 322 | `.x2f-pay__caption` | 14 |
| `screens/trade/pay.css` | 330 | `.x2f-giftcard` | 17 |
| `screens/trade/pay.css` | 372 | `.x2f-proof__title` | 17 |
| `screens/trade/pay.css` | 377 | `.x2f-proof__hint` | 14 |
| `screens/trade/pay.css` | 398 | `.x2f-paid__check` | 17 |
| `screens/trade/pay.css` | 413 | `.x2f-paid__check--quiet` | 15 |
| `screens/trade/pay.css` | 425 | `.x2f-paid__grew` | 17 |
| `screens/trade/pay.css` | 432 | `.x2f-paid__note` | 15 |
| `screens/trade/pay.css` | 440 | `.x2f-paid__error, .x2f-room__error` | 17 |
| `screens/trade/pay.css` | 453 | `.x2f-room__grown` | 17 |
| `screens/trade/pay.css` | 464 | `.x2f-room__hint` | 15 |
| `screens/trade/pay.css` | 478 | `.x2f-room__dispute-locked .x2f-room__dispute-wait` | 14 |
| `screens/trade/pay.css` | 489 | `.x2f-paid__noproof` | 16 |
| `screens/trade/pay.css` | 510 | `.x2f-cancel__proposed` | 16 |
| `screens/trade/pay.css` | 522 | `.x2f-proposal__text` | 17 |
| `screens/trade/pay.css` | 547 | `.x2f-wait__left` | 17 |
| `screens/trade/pay.css` | 676 | `.x2f-timeline__label` | 14 |
| `screens/trade/pay.css` | 715 | `.x2f-counterparty__name` | 17 |
| `screens/trade/pay.css` | 721 | `.x2f-counterparty__line` | 14 |
| `screens/trade/pay.css` | 731 | `.x2f-counterparty__badge` | 13 |
| `screens/trade/pay.css` | 794 | `.x2f-paid-progress__label` | 13 |
| `screens/trade/pay.css` | 800 | `.x2f-room[data-layout='wide'] .x2f-paid-progress__label` | 14 |
| `screens/trade/pay.css` | 845 | `.x2f-paid-soft-dispute` | 16 |
| `screens/trade/refund.css` | 45 | `.x2f-refund__lead` | 17 |
| `screens/trade/refund.css` | 61 | `.x2f-refund__card-title` | 17 |
| `screens/trade/refund.css` | 72 | `.x2f-refund__steps` | 15 |
| `screens/trade/refund.css` | 80 | `.x2f-refund__late` | 15 |
| `screens/trade/refund.css` | 96 | `.x2f-refund__check p` | 15 |
| `screens/trade/refund.css` | 123 | `.x2f-refund__footer > [data-refund-lock-note]` | 14 |
| `screens/trade/refund.css` | 146 | `.x2f-refund__error, .x2f-refund__note` | 15 |
| `screens/trade/refund.css` | 168 | `.x2f-refund__timer-label` | 14 |
| `screens/trade/refund.css` | 193 | `.x2f-refund__chat` | 16 |
| `screens/trade/release/release.css` | 38 | `.x2f-release__chat` | 16 |
| `screens/trade/release/release.css` | 74 | `.x2f-release__window` | 17 |
| `screens/trade/release/release.css` | 93 | `.x2f-release__tip` | 17 |
| `screens/trade/release/release.css` | 113 | `.x2f-release__prompt` | 17 |
| `screens/trade/release/release.css` | 132 | `.x2f-release__warning-title` | 17 |
| `screens/trade/release/release.css` | 142 | `.x2f-release__check` | 17 |
| `screens/trade/release/release.css` | 174 | `.x2f-release__hint, .x2f-release__error` | 17 |
| `screens/trade/release/release.css` | 207 | `.x2f-released__label` | 14 |
| `screens/trade/release/release.css` | 226 | `.x2f-released__where` | 17 |
| `screens/trade/release/release.css` | 244 | `.x2f-released__sums` | 17 |
| `screens/trade/release/release.css` | 288 | `.x2f-released__confirm-row` | 17 |
| `screens/trade/release/release.css` | 312 | `.x2f-released__confirm .x2f-link` | 17 |
| `screens/trade/release/release.css` | 316 | `.x2f-released__note` | 15 |
| `screens/trade/trade.css` | 130 | `.x2f-trade-quote__rows` | 15 |
| `screens/trade/trade.css` | 145 | `.x2f-quote-row[data-total='true']` | 17 |
| `screens/trade/trade.css` | 175 | `.x2f-how__head h2` | 17 |
| `screens/trade/trade.css` | 181 | `.x2f-how__head .x2f-muted` | 14 |
| `screens/trade/trade.css` | 192 | `.x2f-how__list` | 15 |
| `screens/trade/trade.css` | 284 | `.x2f-fund-hint` | 13 |
| `screens/trade/trade.css` | 321 | `.x2f-fund-address` | 15 |
| `screens/trade/trade.css` | 342 | `.x2f-fund-copied` | 15 |
| `screens/trade/warn.css` | 10 | `.x2f-warn__text` | 17 |
| `screens/trades/trades.css` | 51 | `.x2f-trades__line` | 15 |
| `screens/welcome/welcome.css` | 86 | `.x2f-hello__line` | 17 |
| `screens/welcome/welcome.css` | 124 | `.x2f-hello__link` | 16 |
| `tour/stage.css` | 61 | `.x2f-ex__h2` | 17 |
| `tour/stage.css` | 71 | `.x2f-ex__meta` | 14 |
| `tour/stage.css` | 81 | `.x2f-ex__chip` | 12 |
| `tour/stage.css` | 139 | `.x2f-ex__cap` | 13 |
| `tour/stage.css` | 180 | `.x2f-ex__big small, .x2f-ex__price small, .x2f-ex__pct small` | 14 |
| `tour/stage.css` | 186 | `.x2f-ex__muted` | 14 |
| `tour/stage.css` | 195 | `.x2f-ex__sech` | 15 |
| `tour/stage.css` | 228 | `.x2f-ex__mname small, .x2f-ex__name small` | 13 |
| `tour/stage.css` | 256 | `.x2f-ex__avatar` | 14 |
| `tour/stage.css` | 260 | `.x2f-ex__vendor` | 12 |
| `tour/stage.css` | 273 | `.x2f-ex__badge` | 13 |
| `tour/stage.css` | 297 | `.x2f-ex__limits` | 13 |
| `tour/stage.css` | 394 | `.x2f-ex__steps` | 12 |
| `tour/stage.css` | 410 | `.x2f-ex__deal` | 14 |
| `tour/stage.css` | 417 | `.x2f-ex__status` | 13 |
| `tour/tour.css` | 97 | `.x2f-tour__count` | 15 |
| `tour/tour.css` | 129 | `.x2f-tour__body` | 17 |
| `tour/tour.css` | 146 | `.x2f-tour__skip` | 16 |
| `tour/tour.css` | 173 | `.x2f-tour-closed` | 16 |
| `tour/tour.css` | 194 | `.x2f-tour__body` | 17 |
| `tour/tour.css` | 351 | `.x2f-tour-replay__text small` | 15 |
| `ui/big-banner.css` | 13 | `.x2f-big-banner` | 17 |
| `ui/hero.css` | 125 | `.x2f-hero__line` | 15 |
| `ui/hero.css` | 218 | `.x2f-hero__amount .x2f-xmr__unit` | 16 |
| `ui/hero.css` | 226 | `.x2f-hero__fiat` | 17 |
| `ui/hero.css` | 242 | `.x2f-hero__row dt` | 15 |
| `ui/hero.css` | 247 | `.x2f-hero__row dd` | 17 |
| `ui/hero.css` | 269 | `.x2f-segments__head` | 15 |
| `ui/hero.css` | 342 | `.x2f-stepper__label` | 13 |
| `ui/kit.css` | 33 | `.x2f-avatar` | 15 |
| `ui/kit.css` | 51 | `.x2f-avatar[data-size='32']` | 13 |
| `ui/kit.css` | 77 | `.x2f-avatar[data-kind='x2f']` | 11 |
| `ui/kit.css` | 119 | `.x2f-tag` | 11 |
| `ui/kit.css` | 205 | `.x2f-ident__name` | 17 |
| `ui/kit.css` | 212 | `.x2f-ident[data-size='40'] .x2f-ident__name, .x2f-ident__name[data-size='40']` | 17 |
| `ui/kit.css` | 226 | `.x2f-ident__meta` | 14 |
| `ui/kit.css` | 262 | `.x2f-stat__v` | 17 |
| `ui/kit.css` | 270 | `.x2f-stat__l` | 13 |
| `ui/kit.css` | 329 | `.x2f-recipient__xmr .x2f-digits` | 17 |
| `ui/kit.css` | 336 | `.x2f-recipient__unit` | 15 |
| `ui/kit.css` | 342 | `.x2f-recipient__fiat` | 14 |
| `ui/kit.css` | 380 | `.x2f-seal__num` | 13 |
| `ui/kit.css` | 387 | `.x2f-seal[data-size='28'] .x2f-seal__num` | 9.5 |
| `ui/kit.css` | 391 | `.x2f-seal[data-size='22'] .x2f-seal__num` | 8 |
| `ui/kit.css` | 452 | `.x2f-chip-k__pill` | 14 |
| `ui/kit.css` | 480 | `.x2f-more-k` | 14 |
| `ui/kit.css` | 519 | `.x2f-badge-row__name` | 16 |
| `ui/kit.css` | 527 | `.x2f-badge-row__meaning, .x2f-badge-row__earned` | 14 |
| `ui/kit.css` | 532 | `.x2f-badge-row__earned` | 13 |
| `ui/ui.css` | 42 | `.x2f-button--secondary` | 17 |
| `ui/ui.css` | 51 | `.x2f-button--quiet, .x2f-button--danger` | 16 |
| `ui/ui.css` | 80 | `.x2f-button--tertiary` | 16 |
| `ui/ui.css` | 166 | `.x2f-badge` | 13 |
| `ui/ui.css` | 333 | `.x2f-trade-header__sub` | 14 |
| `ui/ui.css` | 428 | `.x2f-sheet__eyebrow` | 14 |
| `ui/ui.css` | 505 | `.x2f-hold__top` | 13 |
| `ui/ui.css` | 549 | `.x2f-bottom-nav__tab` | 13 |
| `ui/ui.css` | 647 | `.x2f-rail__page` | 17 |
| `ui/ui.css` | 743 | `.x2f-button--danger-outline[data-size='medium']` | 17 |
| `ui/ui.css` | 991 | `.x2f-choice[data-look='card'] .x2f-choice__label` | 17 |
| `ui/ui.css` | 998 | `.x2f-choice__note` | 15 |
| `ui/ui.css` | 1072 | `.x2f-outcome` | 15 |
| `ui/ui.css` | 1080 | `.x2f-outcome[data-tone='neutral']` | 16 |
| `ui/ui.css` | 1174 | `.x2f-team-empty__title` | 17 |
| `ui/ui.css` | 1204 | `.x2f-disclosure__button` | 17 |
| `ui/ui.css` | 1232 | `.x2f-disclosure__note` | 15 |
| `ui/ui.css` | 1251 | `.x2f-disclosure ol` | 16 |
| `ui/ui.css` | 1295 | `.x2f-flow__sub` | 14 |
| `ui/ui.css` | 1325 | `.x2f-flow[data-header='compact'] .x2f-flow__title` | 16 |
| `ui/ui.css` | 1395 | `[data-shell='desktop'] .x2f-flow[data-look='card'] .x2f-flow__footer > .x2f-button` | 17 |
| `ui/ui.css` | 1486 | `.x2f-h3` | 17 |
| `ui/ui.css` | 1493 | `.x2f-body` | 17 |
| `ui/ui.css` | 1500 | `.x2f-fine` | 15 |
| `ui/ui.css` | 1520 | `.x2f-icon-line` | 17 |
| `ui/ui.css` | 1557 | `.x2f-panel[data-tone='caution'] .x2f-h3` | 16 |
| `ui/ui.css` | 1608 | `.x2f-facts dt` | 15 |
| `ui/ui.css` | 1614 | `.x2f-facts dd` | 16 |
| `ui/ui.css` | 1619 | `.x2f-facts dd[data-strong='true']` | 17 |
| `ui/ui.css` | 1739 | `.x2f-item__name` | 17 |
| `ui/ui.css` | 1747 | `.x2f-item__note` | 15 |
| `ui/ui.css` | 1760 | `.x2f-button--small` | 16 |
| `ui/ui.css` | 1841 | `.x2f-lead` | 17 |
| `ui/ui.css` | 1858 | `.x2f-panel__title` | 17 |
| `ui/ui.css` | 1888 | `.x2f-facts[data-layout='rows'] dd` | 15 |
| `ui/ui.css` | 1902 | `.x2f-steps` | 16 |
| `ui/ui.css` | 1985 | `.x2f-post__meta` | 14 |
| `ui/ui.css` | 2009 | `.x2f-post__title` | 17 |
| `ui/ui.css` | 2054 | `.x2f-header-action` | 16 |
| `ui/ui.css` | 2234 | `.x2f-action-bar[data-selection='true'] > :first-child` | 16 |
| `ui/ui.css` | 2249 | `.x2f-action-bar[data-selection='true'] .x2f-button--secondary` | 16 |
| `ui/ui.css` | 2263 | `.x2f-select-card__title` | 17 |
| `ui/ui.css` | 2289 | `.x2f-timer__hint` | 15 |
| `ui/ui.css` | 2340 | `.x2f-outcome-card__day` | 14 |
| `ui/ui.css` | 2418 | `.x2f-steps-line__text` | 16 |
| `ui/ui.css` | 2428 | `.x2f-steps-line__text .x2f-when` | 15 |
| `ui/ui.css` | 2445 | `.x2f-inline-action` | 16 |
| `ui/ui.css` | 2473 | `.x2f-footnote` | 14 |
| `ui/ui.css` | 2486 | `.x2f-field-label` | 16 |
| `ui/ui.css` | 2497 | `.x2f-input--message.x2f-input` | 17 |
| `ui/ui.css` | 2504 | `.x2f-field-count` | 14 |
| `ui/ui.css` | 2521 | `.x2f-news-pager` | 15 |
| `ui/ui.css` | 2552 | `.x2f-check-row__title` | 17 |
| `ui/ui.css` | 2562 | `.x2f-check-row__hint` | 15 |
| `ui/ui.css` | 2568 | `.x2f-select-card__line` | 15 |
| `ui/ui.css` | 2583 | `.x2f-select-card__status` | 14 |
| `ui/ui.css` | 2599 | `.x2f-select-card__why` | 14 |
| `ui/ui.css` | 2626 | `.x2f-empty__text` | 16 |
| `ui/ui.css` | 2651 | `.x2f-select-all__name` | 17 |
| `ui/ui.css` | 2657 | `.x2f-select-all__hint` | 14 |

</details>

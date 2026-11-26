# Foldable phones: research note for X2F design (2026-11-07)

Research for the owner's question about Pixel Fold, "iPhone Duo", Samsung and other foldables. Numbers in brackets refer to the Sources list at the end.

## Correction first: the iPhone Duo is real and on sale

The brief assumed Apple had no foldable. That is out of date. Apple announced the **iPhone Duo** on 9 September 2026 [1]. Pre-orders opened 16 October and it went on sale 23 October 2026 [1][2]. It is a **book fold** (opens like a book into one continuous screen) with a 5.4" cover screen and a 7.6" inner screen, and it runs iOS 27.1 [2]. Before launch it was rumoured as "iPhone Fold" or "iPhone Ultra" [3]; "iPhone Duo" is the official name. It is not a dual-screen device like Microsoft's Surface Duo, despite the name.

Apple has published the Safari viewport sizes in CSS px [4]:

| iPhone Duo screen | Width (CSS px) | Height (small to large viewport) |
|---|---|---|
| Cover, portrait | 382 | 580 to 618 |
| Cover, landscape | 594 | 368 to 406 |
| Inner, portrait | 669 | 867 to 902 |
| Inner, landscape | 951 | 585 to 620 |
| Inner, two Safari windows side by side | 385 each | 571 to 609 |

Two Safari details matter for us. On the cover screen, the system controls sit in a column on the right, and web pages cannot draw behind it yet. Safari fills that strip with the page background colour [4]. The Safari tab bar sits at the bottom on the cover screen and at the top on the inner screen [4].

## 1. Device landscape

Screen sizes are diagonal inches from maker or spec pages. CSS px are given only where a reliable source states them. For Android, CSS width is roughly the physical pixels divided by the device pixel ratio, which changes with the user's display-size setting. Third-party CSS px tables say their own figures are unverified [8], so measure on real devices or in emulators.

| Device | Form factor | Inner / cover screen | Notes |
|---|---|---|---|
| Google Pixel Fold (2023) | Book | 7.6" / 5.8" | Wide, landscape-shaped inner screen |
| Pixel 9 Pro Fold (2024) | Book | 8.0" / 6.3" | |
| Pixel 10 Pro Fold (2025) | Book | 8.0" (2076x2152) / 6.4" (1080x2364) [5] | Inner screen about 692x717 CSS px (unverified) [8] |
| Samsung Galaxy Z Fold5 / Fold6 | Book | 7.6" / 6.2" and 7.6" / 6.3" [6] | Narrow, tall cover screen |
| Galaxy Z Fold7 (2025) | Book | 8.0" / 6.5" [7] | |
| Galaxy Z Fold8 (2026) | Book, wide | 7.6" / 5.5" [7] | Shorter, wider cover screen, close to iPhone Duo proportions [9] |
| Galaxy Z Fold8 Ultra (2026) | Book | 8.0" / 6.5" [7] | |
| Galaxy Z Flip5 / Flip6 | Flip | 6.7" / 3.4" [7] | |
| Galaxy Z Flip7 / Flip8 | Flip | 6.9" / 4.1" [7] | |
| OnePlus Open | Book | about 7.8" / 6.3" | Spec-sheet figure, re-check |
| Honor Magic V5 / V6 | Book | about 8.0" inner (V6: 8.03", 2480x2200) [10] | |
| Vivo X Fold5 / Fold6 | Book | about 8.0" inner [11] | |
| Xiaomi Mix Fold 4 / Mix Flip | Book / flip | about 8.0" inner (Fold) | Mostly sold in China |
| Huawei Mate X6 / X7 | Book, HarmonyOS | about 7.9" inner [12] | Runs HarmonyOS NEXT, not Android, so no Google Chrome [12] |
| Motorola razr / razr+ | Flip | 6.9" / 3.6" to 4.0" [13] | Cover screen can run any full app [14] |
| Microsoft Surface Duo 1 / 2 | **Two separate screens with a hinge** | Duo 1: two 1350x1800 screens plus an 84 px physical gap [15] | Discontinued. Support ended Sept 2023 (Duo 1) and Oct 2024 (Duo 2) [16] |

**The hinge gap.** Only dual-screen devices like the Surface Duo have a real gap with no pixels in it. On the Duo 1 the gap is about 34 CSS px between two 540 px-wide halves (1114 dp total [15]). Every current foldable has one continuous screen with a crease and no gap.

## 2. Back navigation

- **Android gesture navigation** (the default on Pixel, including the owner's Pixel Fold): **Back is an inward swipe from either the left or the right edge.** Swipe up from the bottom goes Home [17][18].
- **3-button navigation** is still a setting on every Android phone (Settings > System or Display > Navigation mode), and it gives an on-screen Back button [18].
- **Samsung One UI** (Settings > Display > Navigation bar): users choose Buttons or Swipe gestures. Under Swipe gestures there are two styles. "Swipe from sides and bottom" works like Pixel. "Swipe from bottom" splits the bottom edge into three zones, and swiping up from one of the side zones is Back [19][20]. Many Samsung owners keep the buttons, so on Samsung we will see the button bar more often than on Pixel.
- **HarmonyOS (Huawei):** a side swipe works as system Back for normal pages [21]. I could not find an official source naming which edge triggers it.
- **Folded or unfolded:** I found no foldable that changes the back gesture when opened. The gesture lives on whichever screen is in use. On Surface Duo and a two-pane unfolded layout, the "left edge" is the outer edge of the whole screen, not the fold.
- **iPhone / iPhone Duo:** there is no system Back button. In Safari, swiping from the left edge goes back. In a home-screen web app (standalone PWA), that swipe has long not worked, so we need our own Back control [22].
- **Predictive back:** Android 13+ shows a preview before Back completes [17]. Since Chrome 138, Chrome for Android has been rolling out a preview of the previous web page during the swipe [23].

**What this means for X2F:**
1. The browser never adds a Back button inside our page. Every screen needs its own visible Back or close control, especially for the iPhone PWA.
2. System Back moves through browser history. Sheets, modals and steps such as review and confirm should push history entries, so that Back closes the sheet instead of leaving the trade.
3. Avoid horizontal swipe gestures that start within about 24-32 px of the left or right edge (carousels, swipe-to-delete, slide-to-confirm). On Android they compete with system Back, and a web page cannot opt out of it the way native apps can [17]. Use a tap or press-and-hold to confirm a trade, not an edge-to-edge swipe.
4. Leave clear space above the bottom edge for the home gesture and Samsung's bottom-swipe zones (use `env(safe-area-inset-bottom)`).

## 3. Detecting a foldable in a web app

**Tools the browser gives us:**
- **Viewport Segments.** CSS: `@media (horizontal-viewport-segments: 2)` (panes side by side) and `(vertical-viewport-segments: 2)` (panes stacked). CSS variables: `env(viewport-segment-width 0 0)`, `-height`, `-top`, `-left`, `-right` and `-bottom`, indexed by column and row. JS: `window.viewport.segments`, an array of rectangles [4][24][25]. When the viewport is not split, it reports a single segment [24]. Hinge width = `env(viewport-segment-left 1 0) - env(viewport-segment-right 0 0)` [25].
- **Device Posture.** CSS: `@media (device-posture: folded)` or `continuous`. JS: `navigator.devicePosture.type` with a `change` event [4][26]. `folded` means book or laptop (tabletop) pose. `continuous` means flat open, fully closed, or an ordinary phone [4][26].

**Browser support (November 2026):**

| Browser | Viewport Segments | Device Posture |
|---|---|---|
| Chrome / Edge on Android | On by default since 138 (June 2025) [24] | On by default since 132 (Jan 2025) [27] |
| Samsung Internet | Reported on by default (Chromium-based) [28]; exact version not confirmed | Samsung documents it [29]; version not confirmed |
| Safari 27.1 (iPhone Duo) | **Preview behind a feature flag**, off by default [4] | **Preview behind a feature flag** [4] |
| Firefox | No [24][27] | No |

**What we CAN detect:** whether the page is split into panes and the size of each pane; whether the device is half-folded (book or tabletop) or flat; and screen size and aspect ratio through ordinary media queries. Those work on every phone.

**What we CANNOT reliably detect:** the brand or model ("this is a Galaxy Z Fold7"). User-agent strings are reduced or frozen and can be faked, and Apple explicitly tells developers to use feature detection and responsive design instead of user-agent sniffing [4]. We also cannot read the hinge angle, and we cannot tell an iPhone Duo inner screen from an iPad mini by size alone. On iPhone Duo, until Apple turns the flags on by default, we only get viewport size.

**Tabletop / Flex mode** (half-folded, bottom half flat on a table): this reports `device-posture: folded` with `vertical-viewport-segments: 2`. Apple warns that posture and segment count are separate signals, so do not assume a folded device always has two segments [4].

**Flip cover screens:**
- Samsung Flip: the cover ("Flex Window") runs only approved apps unless the user installs Good Lock / MultiStar. The Flip8 eases that but still limits the list [30][31]. A browser on the cover screen is possible but rare.
- Motorola razr: the cover screen runs any app, including a browser [14].
- iPhone Duo: Safari runs on the 382 px cover screen as normal [4].

We should make sure we do not break on a roughly 3.4-4" square-ish viewport, but we should not design dedicated boards for it.

## 4. Recommendation for X2F

**Layouts to design (by shape, not by brand):**
1. **Phone, about 360-430 px wide.** This is today's board. It covers every cover screen (iPhone Duo 382, Fold cover screens, Flip inner screens) and every ordinary phone.
2. **Unfolded book, about 600-1000 px wide, nearly square.** A two-pane layout: for example, order book or chart on the left and trade ticket on the right; wallet list left and detail right. The same board serves Pixel Fold, Galaxy Fold, OnePlus, Honor, Vivo, Huawei and iPhone Duo inner screens. Design for roughly 670 px (iPhone Duo portrait), 700 px (Pixel 10 Pro Fold) and 950 px (iPhone Duo landscape) and check that the layout stretches cleanly between them.
3. **Tabletop (half-folded, horizontal crease).** Top half shows the chart and price; bottom half shows the controls and keypad. Nothing important should sit on the crease. Triggered only by `vertical-viewport-segments: 2`.
4. **Dual-screen with a physical gap (Surface Duo).** No new board needed. Make the two-pane layout respect the hinge gap through `env(viewport-segment-*)`, so no text or button sits in the gap. Low priority, since the device is discontinued.
5. **Flip cover screen.** No board. Run a "does not break" check at about 300x300 px.

**Do Samsung and others need different boards from Pixel?** No. Screens are about the same shape (the Pixel Fold is a little wider and the Galaxy Fold5/6 cover screens a little narrower), and responsive breakpoints absorb that. The only real behaviour differences:
- Samsung users more often have the 3-button bar or bottom-zone swipes, so keep bottom padding safe.
- The iPhone has no system Back, so our in-app Back control is required, not optional.
- Safari on the iPhone Duo cover screen has a reserved right-hand strip, so make sure our background colour fills it cleanly.

**Detection approach:**
1. Use plain responsive media queries on width and aspect ratio as the base. This works everywhere, including iPhone Duo today.
2. As an enhancement, use `horizontal-viewport-segments: 2` and `vertical-viewport-segments: 2` for split layouts, and `device-posture: folded` for tabletop.
3. In JS, read `window.viewport?.segments` and `navigator.devicePosture?.type` with feature checks, and listen for `resize` and posture `change` events.
4. Never branch on brand or model, and never use user-agent sniffing.
5. Test in Chrome DevTools foldable emulation, the Android Emulator foldable profiles, and the Xcode 27.1 iPhone Duo simulator [4].

## Sources

1. ABC News, Apple announces first foldable iPhone (9 Sep 2026): https://abcnews.com/Business/apple-set-announce-new-products/story?id=136299541
2. MacRumors, iPhone Duo roundup: https://www.macrumors.com/roundup/iphone-duo/
3. MacRumors, Sept 2026 event preview: https://www.macrumors.com/guide/apple-september-2026-what-to-expect/
4. WebKit, Features for Safari 27.1 (23 Oct 2026): https://webkit.org/blog/18486/webkit-features-for-safari-27-1/
5. Google Store, Pixel 10 Pro Fold specs: https://store.google.com/us/product/pixel_10_pro_fold_specs?hl=en-US
6. GSMArena, Galaxy Z Fold specs: https://www.gsmarena.com/samsung-phones-9.php
7. Samsung UK, Galaxy Z compare page: https://www.samsung.com/uk/smartphones/galaxy-z-flip8/compare/
8. ScreenSizeChecker, Android viewport sizes (states figures are unverified): https://screensizechecker.com/devices/android-viewport-sizes
9. Gizchina, Samsung's three foldables diverge: https://www.gizchina.com/samsung/samsungs-three-foldables-are-starting-to-look-very-different-from-each-other
10. Notebookcheck, best foldables: https://www.notebookcheck.net/Ranking-Best-foldables-tested-and-rated.1347925.0.html
11. Smartprix, Honor Magic V6 vs Vivo X Fold6: https://us.smartprix.com/mobiles/honor_magic_v6_vs_vivo_x_fold_6-cpd1mlyv0m60_pd1f1cpweav.php
12. GSMArena, Huawei Mate X6 with HarmonyOS Next: https://www.gsmarena.com/huawei_mate_x6_arrives_with_harmonyos_next_slimmer_body_and_larger_screens-news-65494.php
13. Google Fi, motorola razr 2026: https://fi.google.com/about/phones/motorola-razr-2026
14. 9to5Google, razr cover screen runs full apps: https://9to5google.com/2023/06/01/motorola-razr-display-full-apps/
15. Microsoft Learn, Surface Duo dimensions: https://learn.microsoft.com/dual-screen/android/surface-duo-dimensions
16. Windows Central, Surface Duo 2 support ends: https://windowscentral.com/phones/the-surface-duo-is-dead-microsoft-pulls-plug-on-usd1-500-surface-duo-2-after-just-one-android-os-upgrade
17. Android Developers, gesture navigation: https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav
18. Pixel Help, choose how to get around: https://support.google.com/pixelphone/answer/6073614?hl=en
19. Samsung support, swipe gestures changes: https://www.samsung.com/ae/support/mobile-devices/what-is-changing-with-swipe-gestures/
20. Samsung Community, gesture navigation tutorial: https://r2.community.samsung.com/t5/Galaxy-S/Tutorial-To-Gesture-navigation/td-p/3425775
21. DEV Community, HarmonyOS back gestures: https://dev.to/qingkouwei/image-cropping-disabling-back-gestures-app-icon-size-specifications-database-errors-fdd
22. Apple Developer Forums, no back gesture in home-screen web apps: https://developer.apple.com/forums/thread/99579
23. Android Authority, Chrome back/forward animations: https://www.androidauthority.com/google-chrome-back-forward-animations-3582562
24. Chrome for Developers, Viewport Segments API shipped: https://developer.chrome.com/blog/viewport-segments-api-shipped?hl=en
25. Microsoft Learn, CSS viewport segments: https://learn.microsoft.com/en-us/dual-screen/web/css-viewport-segments
26. Chrome for Developers, Foldable APIs origin trial: https://developer.chrome.com/blog/foldable-apis-ot?hl=en
27. Web features explorer, Device Posture: https://web-platform-dx.github.io/web-features-explorer/features/device-posture
28. WebKit standards positions, Viewport Segments #327: https://www.github.com/WebKit/standards-positions/issues/327
29. Samsung Developer Conference, web experience on Samsung Internet: https://developer.samsung.com/conference/sdc22/sessions/flexible-and-private-web-experience-on-samsung-internet
30. Droid Life, Flip cover screen and Good Lock: https://www.droid-life.com/2023/08/02/galaxy-z-flip-5-cover-screen-apps-good-lock/
31. Android Authority, Galaxy Z Flip8 cover screen apps: https://www.androidauthority.com/galaxy-z-flip-8-cover-screen-apps-3688143/

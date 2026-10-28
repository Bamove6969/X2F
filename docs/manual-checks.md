# Manual checks

Checks a person must do on a real device. Record the date, device, OS and app versions, and the result.

## Press-and-hold release on SellerConfirm (Plan 3 Task 24; spec 2.2 step 9, "release is a 1.5 s hold"; review 2026-10-27 Minor 8)

Owed before Task 31. The e2e (`apps/web/e2e/release.spec.ts`, "a touch hold of 1.7 s releases, 0.7 s
does not") drives the hold with Chromium's emulated touch events; it cannot show what a real
phone's own long-press handling does. Open a trade's SellerConfirm screen as the seller (a stubbed
API as in that spec, or a regtest trade), tick the box, then:

- (a) hold the release with a finger for about 2 s: the bar fills, "Keep holding…" shows, and the
  release starts once (no second release on a longer hold);
- (b) let go after about 0.7 s: nothing is released and the button is back at rest;
- (c) during the hold, record whether the browser shows anything of its own: a context menu
  (Android's long press, about 500 ms), the iOS callout or magnifier, a text selection, or a page
  scroll or zoom. Any of these is a failure (the CSS sets `touch-action: none`, `user-select: none`
  and `-webkit-touch-callout: none`, and the button cancels `contextmenu`);
- (d) slide the finger off the button while holding: for touch, the pointer stays captured to the
  button, so the hold continues until lift (only lift or `pointercancel` cancels it; Task 22 / Task
  14 cross-task note). Record what happens.

| Platform / browser | (a) 2 s hold releases once | (b) 0.7 s releases nothing | (c) no menu, callout, selection or scroll | (d) slide off | Date / device / versions | Who |
| ------------------ | -------------------------- | -------------------------- | ----------------------------------------- | ------------- | ------------------------ | --- |
| Android, Chrome | not checked yet | | | | | |
| Android, installed home-screen web app | not checked yet | | | | | |
| iPhone, Safari | not checked yet | | | | | |
| iPhone, installed home-screen web app | not checked yet | | | | | |

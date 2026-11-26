// DESIGN: owner 17 Nov button labels. "All buttons use as much font as possible... 'Post offer' is so
// tiny, it should be bigger and wider, but never touch the top or the sides." Every orange button's
// label is drawn as large as its button allows (ui.css --x2f-primary-fit, 27 px on the 56 px
// button); only when a long label would reach the 16 px side padding (a narrow phone) does this step
// it down, a pixel at a time, to the 17 px floor. It sets a CSS custom property through the CSSOM,
// which the CSP allows (no style attributes in markup).
const SELECTOR = '.x2f-button--primary, .x2f-ex__button, .x2f-ex__hold';
const FLOOR = 17;
const SIDE = 16;
const PROP = '--x2f-primary-fit';

/** The label is too wide when it comes nearer than 16 px (or the button's own padding) to a side. */
function tooWide(el: HTMLElement): boolean {
  const range = document.createRange();
  range.selectNodeContents(el);
  const text = range.getBoundingClientRect().width;
  const cs = getComputedStyle(el);
  const sides = Math.max(SIDE, parseFloat(cs.paddingLeft)) + Math.max(SIDE, parseFloat(cs.paddingRight));
  return text > el.clientWidth - sides + 0.5;
}

function fit(el: HTMLElement): void {
  el.style.removeProperty(PROP);
  if (el.clientWidth === 0 || !tooWide(el)) return;
  let size = Math.floor(parseFloat(getComputedStyle(el).fontSize));
  while (size > FLOOR && tooWide(el)) {
    size -= 1;
    el.style.setProperty(PROP, `${size}px`);
  }
}

export function fitAll(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(SELECTOR))) fit(el);
}

/** Keeps every orange button's label fitted as screens change and the window resizes. */
export function installPrimaryLabelFit(): () => void {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fitAll();
    });
  };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', schedule);
  // A face that loads after a screen draws changes the label's width: fit again then.
  document.fonts?.addEventListener('loadingdone', schedule);
  void document.fonts?.ready.then(schedule);
  schedule();
  return () => {
    mo.disconnect();
    window.removeEventListener('resize', schedule);
    document.fonts?.removeEventListener('loadingdone', schedule);
  };
}

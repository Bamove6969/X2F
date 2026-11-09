/*
 * DEMO ONLY: the comment layer on the running demo (docs/demo.md), served by the gateway from
 * /__demo/notes.js. Tap Comment, tap a spot, type, send; a numbered pin stays there and opens the
 * thread. Styles go through element.style only (the CSP has style-src 'self'), and every piece of
 * text through textContent. It lives in a shadow root outside React's #root.
 *
 * It never reads a form field's value, a cookie or storage other than its own two keys.
 */
(function () {
  'use strict';
  if (window.__x2fDemoNotes) return;
  window.__x2fDemoNotes = true;

  var POLL_MS = 15000;
  var API = '/__demo/notes';
  var INK = '#f4f4f5';
  var PANEL = '#18181b';
  var LINE = '#3f3f46';
  var MUTED = '#a1a1aa';
  var ACCENT = '#f59e0b';
  var ACCENT_INK = '#1c1917';
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function css(node, styles) {
    Object.keys(styles).forEach(function (k) { node.style[k] = styles[k]; });
    return node;
  }
  function make(tag, styles, text) {
    var n = css(document.createElement(tag), styles || {});
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(label, primary) {
    var b = make('button', {
      minHeight: '44px', minWidth: '44px', padding: '0 14px', borderRadius: '10px', font: '600 15px ' + FONT,
      border: primary ? '0' : '1px solid ' + LINE, background: primary ? ACCENT : 'transparent', color: primary ? ACCENT_INK : INK,
      cursor: 'pointer', touchAction: 'manipulation',
    }, label);
    b.type = 'button';
    return b;
  }

  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private window */ } },
  };

  var seen = {};
  try { (JSON.parse(store.get('x2f-demo-comment-seen') || '[]') || []).forEach(function (id) { seen[id] = true; }); } catch (e) { seen = {}; }
  function saveSeen() { store.set('x2f-demo-comment-seen', JSON.stringify(Object.keys(seen).slice(-500))); }

  var host = make('div', { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '2147483000', pointerEvents: 'none' });
  host.id = 'x2f-demo-notes';
  var root = host.attachShadow({ mode: 'open' });
  var pinsLayer = make('div', {});
  root.appendChild(pinsLayer);

  // ── what a tap records ────────────────────────────────────────────────────────────────────────
  var SKIP = 'input,textarea,select,option,script,style,noscript,[contenteditable],[contenteditable=""]';
  // Screens whose text can be recovery codes, keys or wallet details: the tapped text stays out.
  var PRIVATE_PATHS = /^\/(wallets|setup|login|terms|team\/join|settings\/(security|devices))(\/|$)/;
  var PRIVATE_SCREEN = '[data-screen="wallets"]';

  function screenKey() { return location.pathname + safeHash(); }
  /** The app's routes use short hashes (#chat). A long one is a code from a link and is left out. */
  function safeHash() { return /^#[A-Za-z0-9_-]{1,31}$/.test(location.hash) ? location.hash : ''; }

  function segment(node) {
    var s = node.tagName.toLowerCase();
    if (node.getAttribute('data-screen')) s += '[data-screen="' + CSS.escape(node.getAttribute('data-screen')) + '"]';
    var cls = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : '';
    if (cls) s += '.' + CSS.escape(cls);
    var parent = node.parentElement;
    if (parent) {
      var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
    }
    return s;
  }
  function cssPath(node) {
    var parts = [];
    for (var n = node; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.id && !/\s/.test(n.id)) { parts.unshift('#' + CSS.escape(n.id)); break; }
      parts.unshift(segment(n));
    }
    return parts.join(' > ').slice(0, 800);
  }
  function visibleText(node) {
    if (PRIVATE_PATHS.test(location.pathname) || node.closest(PRIVATE_SCREEN) || node.closest(SKIP)) return '';
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: function (t) {
        var p = t.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        if (p.getClientRects().length === 0 || getComputedStyle(p).visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var out = '';
    var visits = 0;
    while (walker.nextNode() && out.length < 120 && visits++ < 400) out += ' ' + walker.currentNode.nodeValue;
    out = out.replace(/\s+/g, ' ').trim();
    // A run of plain words as long as a recovery phrase is not worth keeping.
    if (/^([a-z]+ ){11,}[a-z]+/.test(out)) return '';
    return out.replace(/[A-Za-z0-9+/=_-]{24,}/g, '[hidden]').slice(0, 120);
  }
  function underPoint(x, y) {
    var list = document.elementsFromPoint(x, y);
    for (var i = 0; i < list.length; i++) if (list[i] !== host) return list[i];
    return document.body;
  }
  function describeTap(x, y) {
    var node = underPoint(x, y);
    var rect = node.getBoundingClientRect();
    var screenNode = node.closest('[data-screen]') || document.querySelector('[data-screen]');
    var nameNode = document.querySelector('[data-screen-name]');
    var w = window.innerWidth;
    var h = window.innerHeight;
    return {
      pathname: location.pathname,
      hash: safeHash(),
      dataScreen: screenNode ? screenNode.getAttribute('data-screen') : null,
      viewport: { width: w, height: h },
      x: Math.round(x),
      y: Math.round(y),
      xPercent: (x / w) * 100,
      yPercent: (y / h) * 100,
      element: {
        css: cssPath(node),
        text: visibleText(node),
        offsetXPercent: rect.width ? ((x - rect.left) / rect.width) * 100 : 50,
        offsetYPercent: rect.height ? ((y - rect.top) / rect.height) * 100 : 50,
      },
      screenName: nameNode ? (nameNode.getAttribute('data-screen-name') || '').slice(0, 64) || null : null,
    };
  }

  // ── talking to the gateway ────────────────────────────────────────────────────────────────────
  function postJson(url, body) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  }

  // ── the Comment button ────────────────────────────────────────────────────────────────────────
  // A 44 px touch area (the button) around a 36 px pill (its label), top-right, clear of the header actions.
  var commentBtn = make('button', {
    position: 'fixed', pointerEvents: 'auto', touchAction: 'none', cursor: 'pointer', boxSizing: 'border-box',
    height: '44px', minWidth: '44px', padding: '4px 0', margin: '0', border: '0', background: 'transparent',
    right: '8px', top: 'calc(8px + env(safe-area-inset-top, 0px))',
  });
  commentBtn.type = 'button';
  var pill = make('span', {
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: '36px', padding: '0 12px', borderRadius: '18px',
    background: ACCENT, color: ACCENT_INK, font: '600 13px ' + FONT, boxShadow: '0 2px 8px rgba(0,0,0,.45)', pointerEvents: 'none',
  }, 'Comment');
  commentBtn.appendChild(pill);
  commentBtn.setAttribute('aria-label', 'Leave a comment on this screen');
  root.appendChild(commentBtn);

  var moved = null;
  try { moved = JSON.parse(store.get('x2f-demo-comment-pos2') || 'null'); } catch (e) { moved = null; }
  if (!moved || typeof moved.left !== 'number' || typeof moved.top !== 'number') moved = null;

  function clampPos(p) {
    var w = commentBtn.offsetWidth || 96;
    var h = commentBtn.offsetHeight || 44;
    return {
      left: Math.max(0, Math.min(window.innerWidth - w, p.left)),
      top: Math.max(0, Math.min(window.innerHeight - h, p.top)),
    };
  }
  var TAPPABLE = 'button, a, input, select, textarea, summary, [role="button"], [role="tab"], [role="link"], [tabindex]';
  function tappableAt(x, y) {
    var n = underPoint(x, y);
    return !!(n && n.closest && n.closest(TAPPABLE));
  }
  /** Sits at the top-right, moved down past any header action it would cover (never past a quarter of the screen). */
  function placeButton() {
    if (moved) {
      var p = clampPos(moved);
      css(commentBtn, { left: p.left + 'px', top: p.top + 'px', right: 'auto' });
      return;
    }
    var w = commentBtn.offsetWidth || 96;
    var ht = commentBtn.offsetHeight || 44;
    var left = Math.max(0, window.innerWidth - 8 - w);
    var top = 8;
    var limit = Math.max(8, Math.min(window.innerHeight * 0.25, window.innerHeight - ht - 8));
    for (; top < limit; top += 8) {
      var y0 = top + 4;
      var y1 = top + ht - 4;
      if (!(tappableAt(left + 4, y0) || tappableAt(left + w - 4, y0) || tappableAt(left + 4, y1) || tappableAt(left + w - 4, y1) || tappableAt(left + w / 2, top + ht / 2))) break;
    }
    css(commentBtn, { right: '8px', left: 'auto', top: 'calc(' + top + 'px + env(safe-area-inset-top, 0px))' });
  }

  var drag = null;
  var dragged = false;
  commentBtn.addEventListener('pointerdown', function (e) {
    var r = commentBtn.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, on: false };
    dragged = false;
    commentBtn.setPointerCapture(e.pointerId);
  });
  commentBtn.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.on = true;
    dragged = true;
    moved = clampPos({ left: e.clientX - drag.dx, top: e.clientY - drag.dy });
    css(commentBtn, { left: moved.left + 'px', top: moved.top + 'px', right: 'auto' });
  });
  function endDrag() {
    if (drag && drag.on && moved) store.set('x2f-demo-comment-pos2', JSON.stringify(moved));
    drag = null;
  }
  commentBtn.addEventListener('pointerup', endDrag);
  commentBtn.addEventListener('pointercancel', endDrag);
  commentBtn.addEventListener('click', function () {
    if (dragged) { dragged = false; return; }
    startPicking();
  });

  // ── toast ─────────────────────────────────────────────────────────────────────────────────────
  var toastTimer = null;
  var toast = make('div', {
    position: 'fixed', left: '50%', transform: 'translateX(-50%)', top: 'calc(12px + env(safe-area-inset-top, 0px))',
    background: PANEL, color: INK, border: '1px solid ' + LINE, borderRadius: '10px', padding: '10px 16px', font: '600 15px ' + FONT, display: 'none',
  });
  toast.setAttribute('role', 'status');
  root.appendChild(toast);
  function flash(text) {
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.style.display = 'none'; }, 2200);
  }

  // ── pick a spot ───────────────────────────────────────────────────────────────────────────────
  var picking = null;
  function stopPicking() {
    if (!picking) return;
    root.removeChild(picking.overlay);
    root.removeChild(picking.banner);
    document.removeEventListener('keydown', picking.onKey, true);
    picking = null;
    commentBtn.style.display = '';
  }
  function startPicking() {
    closeBox();
    commentBtn.style.display = 'none';
    var overlay = make('div', { position: 'fixed', inset: '0', pointerEvents: 'auto', background: 'rgba(0,0,0,.28)', cursor: 'crosshair', touchAction: 'manipulation' });
    var banner = make('div', {
      position: 'fixed', top: 'calc(10px + env(safe-area-inset-top, 0px))', left: '12px', right: '12px', maxWidth: '420px', margin: '0 auto',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', pointerEvents: 'auto',
      background: PANEL, color: INK, border: '1px solid ' + LINE, borderRadius: '12px', padding: '8px 8px 8px 14px', font: '600 16px ' + FONT,
    });
    banner.appendChild(make('span', {}, 'Tap the spot you mean'));
    var cancel = button('Cancel');
    banner.appendChild(cancel);
    cancel.addEventListener('click', function (e) { e.stopPropagation(); stopPicking(); });
    overlay.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var tap = describeTap(e.clientX, e.clientY);
      stopPicking();
      openNewComment(tap, e.clientX, e.clientY);
    });
    var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); stopPicking(); } };
    document.addEventListener('keydown', onKey, true);
    root.appendChild(overlay);
    root.appendChild(banner);
    picking = { overlay: overlay, banner: banner, onKey: onKey };
  }

  // ── the box: a new comment, or a thread ───────────────────────────────────────────────────────
  var box = null; // { node, x, y, marker, threadId, list, errorLine }

  function closeBox() {
    if (!box) return;
    root.removeChild(box.node);
    if (box.marker) root.removeChild(box.marker);
    box = null;
    commentBtn.style.display = '';
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', placeBox);
  }
  function placeBox() {
    if (!box) return;
    var vv = window.visualViewport;
    var top0 = vv ? vv.offsetTop : 0;
    var left0 = vv ? vv.offsetLeft : 0;
    var vw = vv ? vv.width : window.innerWidth;
    var vh = vv ? vv.height : window.innerHeight;
    var w = Math.min(320, vw - 24);
    box.node.style.width = w + 'px';
    var h = box.node.offsetHeight;
    var left = Math.max(left0 + 12, Math.min(left0 + vw - w - 12, box.x - w / 2));
    var top = box.y + 18;
    if (top + h > top0 + vh - 8) top = box.y - h - 18;
    top = Math.max(top0 + 8, Math.min(top0 + vh - h - 8, top));
    css(box.node, { left: left + 'px', top: top + 'px' });
  }
  function frame(x, y, threadId) {
    closeBox();
    commentBtn.style.display = 'none';
    var node = make('div', {
      position: 'fixed', pointerEvents: 'auto', boxSizing: 'border-box', background: PANEL, color: INK, border: '1px solid ' + LINE,
      borderRadius: '14px', padding: '12px', boxShadow: '0 8px 28px rgba(0,0,0,.55)', font: '400 15px/1.4 ' + FONT,
    });
    // The app's keyboard handling and click-outside listeners stay out of this.
    ['keydown', 'keyup', 'keypress', 'click', 'pointerdown', 'touchstart'].forEach(function (t) {
      node.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    root.appendChild(node);
    box = { node: node, x: x, y: y, marker: null, threadId: threadId || null, list: null, errorLine: null };
    if (window.visualViewport) window.visualViewport.addEventListener('resize', placeBox);
    return node;
  }
  function field(placeholder) {
    var t = make('textarea', {
      display: 'block', width: '100%', boxSizing: 'border-box', minHeight: '76px', resize: 'none', background: '#09090b', color: INK,
      border: '1px solid ' + LINE, borderRadius: '10px', padding: '10px', font: '400 16px/1.35 ' + FONT,
    });
    t.placeholder = placeholder;
    t.maxLength = 2000;
    return t;
  }
  function errorLine() {
    var e = make('div', { color: '#fca5a5', font: '400 14px ' + FONT, margin: '8px 0 0', display: 'none' });
    e.setAttribute('role', 'alert');
    return e;
  }
  function showError(line, status) {
    line.textContent = status === '429' ? 'Too many at once. Wait a minute and send again.'
      : status === '413' ? 'That is too long to send.'
      : 'That did not send. Check your connection and send again.';
    line.style.display = 'block';
    placeBox();
  }
  function row(justify) { return make('div', { display: 'flex', justifyContent: justify, gap: '8px', marginTop: '10px' }); }

  function openNewComment(tap, x, y) {
    var node = frame(x, y);
    box.marker = dot('+', x, y);
    root.appendChild(box.marker);
    var text = field('What should change here?');
    var err = errorLine();
    var buttons = row('flex-end');
    var cancel = button('Cancel');
    var send = button('Send', true);
    buttons.appendChild(cancel);
    buttons.appendChild(send);
    node.appendChild(text);
    node.appendChild(err);
    node.appendChild(buttons);
    placeBox();
    text.focus();
    cancel.addEventListener('click', closeBox);
    send.addEventListener('click', function () {
      var value = text.value.trim();
      if (!value) { text.focus(); return; }
      send.disabled = true;
      err.style.display = 'none';
      var sentFrom = screenKey();
      tap.text = value;
      postJson(API, tap).then(function () {
        closeBox();
        flash('Sent');
        if (sentFrom === screenKey()) refresh();
      }, function (e) {
        send.disabled = false;
        showError(err, e.message);
      });
    });
  }

  function bubble(entry) {
    var mine = entry.from === 'you';
    var wrap = make('div', { marginBottom: '10px' });
    wrap.appendChild(make('div', { color: mine ? MUTED : ACCENT, font: '600 12px ' + FONT, marginBottom: '2px' }, mine ? 'You' : 'Reply'));
    wrap.appendChild(make('div', { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }, entry.text));
    return wrap;
  }
  function entriesOf(n) { return [{ id: n.id, from: 'you', text: n.text }].concat(n.thread); }
  function markSeen(n) {
    var changed = false;
    n.thread.forEach(function (t) { if (t.from === 'team' && !seen[t.id]) { seen[t.id] = true; changed = true; } });
    if (changed) saveSeen();
  }
  function fillThread(n) {
    if (!box || !box.list) return;
    var atEnd = box.list.scrollTop + box.list.clientHeight >= box.list.scrollHeight - 8;
    box.list.textContent = '';
    entriesOf(n).forEach(function (e) { box.list.appendChild(bubble(e)); });
    if (atEnd) box.list.scrollTop = box.list.scrollHeight;
  }
  function openThread(n, number) {
    var p = pinPoint(n);
    var node = frame(p.x, p.y, n.id);
    var head = make('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' });
    head.appendChild(make('strong', { font: '600 15px ' + FONT }, 'Comment ' + number));
    var close = button('Close');
    head.appendChild(close);
    node.appendChild(head);
    var list = make('div', { maxHeight: '36vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' });
    node.appendChild(list);
    box.list = list;
    fillThread(n);
    list.scrollTop = list.scrollHeight;
    var text = field('Add to this thread');
    text.style.minHeight = '56px';
    var err = errorLine();
    var buttons = row('space-between');
    var resolve = button('Resolve');
    var send = button('Send', true);
    buttons.appendChild(resolve);
    buttons.appendChild(send);
    node.appendChild(text);
    node.appendChild(err);
    node.appendChild(buttons);
    placeBox();
    markSeen(n);
    drawPins();
    close.addEventListener('click', closeBox);
    resolve.addEventListener('click', function () {
      resolve.disabled = true;
      postJson(API + '/resolve', { id: n.id }).then(function () {
        closeBox();
        flash('Resolved');
        refresh();
      }, function (e) {
        resolve.disabled = false;
        showError(err, e.message);
      });
    });
    send.addEventListener('click', function () {
      var value = text.value.trim();
      if (!value) { text.focus(); return; }
      send.disabled = true;
      err.style.display = 'none';
      postJson(API, { text: value, parentId: n.id }).then(function () {
        send.disabled = false;
        text.value = '';
        flash('Sent');
        refresh();
      }, function (e) {
        send.disabled = false;
        showError(err, e.message);
      });
    });
  }

  // ── pins ──────────────────────────────────────────────────────────────────────────────────────
  var notes = [];
  var pins = []; // { node, note }

  function dot(label, x, y) {
    var d = make('div', {
      position: 'fixed', width: '26px', height: '26px', marginLeft: '-13px', marginTop: '-13px', borderRadius: '50%',
      background: ACCENT, color: ACCENT_INK, font: '700 13px/26px ' + FONT, textAlign: 'center', boxShadow: '0 1px 6px rgba(0,0,0,.6)',
      left: x + 'px', top: y + 'px',
    }, label);
    return d;
  }
  function pinPoint(n) {
    if (n.css) {
      var target = null;
      try { target = document.querySelector(n.css); } catch (e) { target = null; }
      if (target) {
        var r = target.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { x: r.left + (r.width * n.offsetXPercent) / 100, y: r.top + (r.height * n.offsetYPercent) / 100 };
      }
    }
    return { x: (n.xPercent / 100) * window.innerWidth, y: (n.yPercent / 100) * window.innerHeight };
  }
  function hasUnread(n) { return n.thread.some(function (t) { return t.from === 'team' && !seen[t.id]; }); }

  function drawPins() {
    pinsLayer.textContent = '';
    pins = [];
    notes.forEach(function (n, i) {
      if (n.resolved) return;
      var p = pinPoint(n);
      var number = i + 1;
      var pin = dot(String(number), p.x, p.y);
      pin.style.pointerEvents = 'auto';
      pin.style.cursor = 'pointer';
      pin.setAttribute('role', 'button');
      pin.setAttribute('aria-label', 'Comment ' + number + ': ' + n.text);
      if (hasUnread(n)) {
        var mark = make('span', { position: 'absolute', top: '-3px', right: '-3px', width: '11px', height: '11px', borderRadius: '50%', background: '#ef4444', border: '2px solid ' + PANEL });
        mark.setAttribute('aria-label', 'New reply');
        pin.appendChild(mark);
      }
      pin.addEventListener('click', function (e) { e.stopPropagation(); openThread(n, number); });
      pinsLayer.appendChild(pin);
      pins.push({ node: pin, note: n });
    });
  }
  var layoutQueued = false;
  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    window.requestAnimationFrame(function () {
      layoutQueued = false;
      pins.forEach(function (p) {
        var at = pinPoint(p.note);
        p.node.style.left = at.x + 'px';
        p.node.style.top = at.y + 'px';
      });
      if (!picking && !box) placeButton();
    });
  }

  var fetching = 0;
  function refresh() {
    var key = screenKey();
    var ticket = ++fetching;
    return fetch(API + '?path=' + encodeURIComponent(key), { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || ticket !== fetching || key !== screenKey()) return;
        notes = data.notes;
        if (box && box.threadId) {
          var open = notes.filter(function (n) { return n.id === box.threadId; })[0];
          if (open && !open.resolved) { fillThread(open); markSeen(open); } else closeBox();
        }
        drawPins();
        queueLayout();
      })
      .catch(function () { /* the next poll tries again */ });
  }

  var lastKey = null;
  function checkRoute() {
    var key = screenKey();
    if (key === lastKey) return;
    lastKey = key;
    stopPicking();
    closeBox();
    notes = [];
    drawPins();
    refresh();
    queueLayout();
  }

  function start() {
    document.body.appendChild(host);
    placeButton();
    checkRoute();
    window.addEventListener('popstate', checkRoute);
    window.addEventListener('hashchange', checkRoute);
    setInterval(checkRoute, 400); // the app's router has no event of its own to listen to
    setInterval(queueLayout, 1000);
    setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    window.addEventListener('scroll', queueLayout, { capture: true, passive: true });
    window.addEventListener('resize', queueLayout);
    new MutationObserver(queueLayout).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();

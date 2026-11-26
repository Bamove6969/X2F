#!/usr/bin/env node
/*
 * render-board.js — render an X2F `.dc.html` board to a PNG with headless Chromium.
 *
 * Usage:
 *   node render-board.js <board.dc.html> <out.png> [theme] [json-props]
 *
 *   theme       night | day          (default: night; shorthand for {"theme": ...})
 *   json-props  JSON merged over the data-props defaults, e.g. '{"variant":"moderator"}'.
 *               Special keys (not passed as props):
 *                 "$state": {...}     merged into this.state after the constructor runs
 *                                     e.g. '{"$state":{"confirm":true,"ticked":true}}'
 *                 "$click": ["sel"]   Playwright selectors clicked in order before the shot
 *                                     e.g. '{"$click":["text=I\'ve paid"]}'
 *                 "$hover": "sel"     selector hovered last (for tooltips)
 *
 * What it does: a stand-in for the dc runtime, good enough for visual checks.
 *   - <helmet> content goes into <head> (fonts load from Google through the session proxy).
 *   - `{{a.b}}` holes are plain dotted lookups into renderVals() (+ sc-for loop vars).
 *     A whole-attribute hole keeps its type (functions become event listeners:
 *     onClick -> click, onMouseEnter -> mouseenter, onChange -> change, ...;
 *     checked/disabled/selected/value are set as properties).
 *   - <sc-if value="{{x}}"> keeps children when x is truthy; <sc-for list="{{l}}" as="r">
 *     repeats children per item. setState() re-renders, so clicks work.
 *   - Warnings (unresolved holes, page errors) are printed to stderr; exit code 0 regardless.
 *
 * Requires: require('playwright') resolvable (it is installed globally in this container).
 * The screenshot is clipped to the board root (the first element inside <x-dc>).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const [, , boardPath, outPath, themeArg, jsonArg] = process.argv;
  if (!boardPath || !outPath) {
    console.error('usage: node render-board.js <board.dc.html> <out.png> [theme] [json-props]');
    process.exit(2);
  }
  const src = fs.readFileSync(boardPath, 'utf8');
  const xdc = (src.match(/<x-dc>([\s\S]*?)<\/x-dc>/) || [])[1];
  const scriptM = src.match(/<script type="text\/x-dc"[^>]*data-props='([^']*)'[^>]*>([\s\S]*?)<\/script>/);
  if (!xdc || !scriptM) throw new Error('no <x-dc> markup or dc-script found');
  const propsDef = JSON.parse(scriptM[1]);
  const code = scriptM[2];
  const helmet = (xdc.match(/<helmet>([\s\S]*?)<\/helmet>/) || ['', ''])[1];
  const body = xdc.replace(/<helmet>[\s\S]*?<\/helmet>/, '');

  const extra = jsonArg ? JSON.parse(jsonArg) : {};
  const props = {};
  for (const [k, d] of Object.entries(propsDef)) if (!k.startsWith('$') && d && 'default' in d) props[k] = d.default;
  if (themeArg) props.theme = themeArg;
  const st = extra.$state || {}, clicks = extra.$click || [], hover = extra.$hover;
  for (const [k, v] of Object.entries(extra)) if (!k.startsWith('$')) props[k] = v;
  const width = (propsDef.$preview && propsDef.$preview.width) || 390;

  const runtime = `
  const WARN = new Set();
  class DCLogic { constructor(p){ this.props = p; this.state = {}; }
    setState(p){ Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); render(); } }
  const Component = new Function('DCLogic', ${JSON.stringify(code)} + '\\n;return Component;')(DCLogic);
  const comp = new Component(${JSON.stringify(props)});
  Object.assign(comp.state, ${JSON.stringify(st)});
  const look = (scope, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
  const HOLE = /\\{\\{\\s*([^}]+?)\\s*\\}\\}/g, WHOLE = /^\\{\\{\\s*([^}]+?)\\s*\\}\\}$/;
  function val(scope, expr) {
    if (!/^[A-Za-z_$][\\w$]*(\\.[\\w$]+)*$/.test(expr)) { WARN.add('non-plain hole {{' + expr + '}}'); }
    const v = look(scope, expr);
    if (v === undefined) WARN.add('unresolved {{' + expr + '}}');
    return v;
  }
  const interp = (scope, s) => s.replace(HOLE, (_, e) => { const v = val(scope, e); return v == null || v === false ? '' : String(v); });
  function walk(node, scope) {
    if (node.nodeType === 3) { if (node.data.includes('{{')) node.data = interp(scope, node.data); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-if') {
      const m = (node.getAttribute('value') || '').match(WHOLE);
      const keep = m ? !!val(scope, m[1]) : false;
      const frag = document.createDocumentFragment();
      if (keep) { [...node.childNodes].forEach(c => { frag.appendChild(c); walk(c, scope); }); }
      node.replaceWith(frag); return;
    }
    if (tag === 'sc-for') {
      const m = (node.getAttribute('list') || '').match(WHOLE);
      const list = (m && val(scope, m[1])) || [];
      const as = node.getAttribute('as') || 'item';
      const frag = document.createDocumentFragment();
      list.forEach((item, i) => {
        const s = Object.create(scope); s[as] = item; s.$index = i;
        [...node.childNodes].forEach(c => { const k = c.cloneNode(true); frag.appendChild(k); walk(k, s); });
      });
      node.replaceWith(frag); return;
    }
    for (const a of [...node.attributes]) {
      if (!a.value.includes('{{')) continue;
      const m = a.value.match(WHOLE);
      if (m) {
        const v = val(scope, m[1]);
        if (a.name.startsWith('on')) { node.removeAttribute(a.name); if (typeof v === 'function') node.addEventListener(a.name.slice(2), v); }
        else if (['checked', 'disabled', 'selected', 'value'].includes(a.name)) { node.removeAttribute(a.name); node[a.name] = a.name === 'value' ? (v == null ? '' : v) : !!v; if (v && a.name !== 'value') node.setAttribute(a.name, ''); }
        else if (v == null || v === false) node.removeAttribute(a.name);
        else node.setAttribute(a.name, String(v));
      } else node.setAttribute(a.name, interp(scope, a.value));
    }
    [...node.childNodes].forEach(c => walk(c, scope));
  }
  function render() {
    let vals; try { vals = comp.renderVals(); } catch (e) { WARN.add('renderVals threw: ' + e.message); vals = {}; }
    const frag = document.getElementById('tpl').content.cloneNode(true);
    [...frag.childNodes].forEach(c => walk(c, vals));
    const mount = document.getElementById('mount'); mount.replaceChildren(frag);
  }
  render();
  window.__warn = () => [...WARN];`;

  const html = `<!doctype html><html><head><meta charset="utf-8">${helmet}</head>
<body style="margin:0;background:#888"><div id="mount" style="display:inline-block"></div>
<template id="tpl">${body}</template><script>${runtime}</script></body></html>`;

  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'render-board-'));
  const page_ = path.join(tmp, 'page.html');
  fs.writeFileSync(page_, html);
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  try {
    const page = await browser.newPage({ viewport: { width: width + 40, height: 1000 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.error('pageerror:', e.message));
    await page.goto('file://' + page_, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.error('load:', e.message));
    await page.evaluate(async () => { await Promise.all(['700 16px "Familjen Grotesk"', '16px "Atkinson Hyperlegible Next"', '16px "Atkinson Hyperlegible Mono"'].map(f => document.fonts.load(f).catch(() => 0))); await document.fonts.ready; });
    for (const sel of clicks) await page.locator(sel).first().click({ timeout: 5000 }).catch(e => console.error('click', sel, e.message));
    if (hover) await page.locator(hover).first().hover({ timeout: 5000 }).catch(e => console.error('hover', e.message));
    await page.waitForTimeout(250);
    const fontsOk = await page.evaluate(() => ['Familjen Grotesk', 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible Mono'].map(f => f + ':' + document.fonts.check((f[0] === 'F' ? '700 ' : '') + '16px "' + f + '"')));
    if (fontsOk.some(s => s.endsWith('false'))) console.error('fonts:', fontsOk.join(' '));
    for (const w of await page.evaluate(() => window.__warn())) console.error('warn:', w);
    const root = page.locator('#mount > *').first();
    await root.screenshot({ path: outPath });
    console.log('wrote', outPath);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exit(1); });

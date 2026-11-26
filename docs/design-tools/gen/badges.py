M="font-family: 'Atkinson Hyperlegible Mono', monospace;"
F="font-family: 'Familjen Grotesk', sans-serif;"
IC={
 'shield':'<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
 'bolt':'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
 'medal':'<circle cx="12" cy="9" r="5"/><path d="M9 13.5L7.5 21l4.5-2.5 4.5 2.5L15 13.5"/>',
 'clean':'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9"/>',
 'key':'<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 6l3 3"/>',
 'hwkey':'<rect x="8" y="2.5" width="8" height="8" rx="1.5"/><path d="M6.5 10.5h11V15a5.5 5.5 0 01-11 0z"/><path d="M12 14v2.5"/>',
 'sprout':'<path d="M12 21v-8"/><path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6z"/><path d="M12 15c0-3-2.5-5-6-5 0 3 2.5 5 6 5z"/>',
 'store':'<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 01-5.3 1.9A3 3 0 0112 14a3 3 0 01-2.7-1.1A3 3 0 014 11z"/><path d="M5.5 14v6h13v-6"/>',
 'chev':'<path d="M6 9l6 6 6-6"/>','x':'<path d="M6 6l12 12M18 6L6 18"/>','cursor':'<path d="M5 3l14 8-6 2-3 6z"/>',
}
def svg(n,s=16,sw=1.75,extra=''): return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{extra}>{IC[n]}</svg>'
# badge: key, name, family tone, glyph (icon or numeral), meaning, earned
B=[('trusted','Trusted','escrow','shield','200+ trades and 98%+ positive.','Earned 12 Mar 2026'),
   ('clean','Clean record','escrow','clean','No lost disputes in 100 trades.','Earned 2 Jun 2026'),
   ('veteran','Veteran','escrow','medal','Trading on X2F for over a year.','Earned 1 Oct 2026'),
   ('fast','Fast','caution','bolt','Usually pays or releases within 10 min.','Earned 20 Apr 2026'),
   ('pgp','PGP verified','ink','key','Logs in with a verified PGP key.','Since 4 Jan 2026'),
   ('hw','Security key','ink','hwkey','Protects the account with a hardware key.','Since 4 Jan 2026'),
   ('m100','100 trades','ink','#100','Completed 100 trades.','Earned 28 Feb 2026'),
   ('m500','500 trades','ink','#500','Completed 500 trades.','Not yet: 212 of 500'),
   ('new','New','ink-muted','sprout','Joined in the last 30 days.','Shown for 30 days')]
BY={b[0]:b for b in B}
def glyph(b,size):
    g=b[3]
    if g.startswith('#'):
        fs={22:8,28:9.5,40:12}[size]
        return f'<span style="{M} font-size: {fs}px; line-height: 1; font-weight: 500; letter-spacing: -0.02em;">{g[1:]}</span>'
    return svg(g,{22:13,28:16,40:20}[size])
def seal(b,size=40):
    t=b[2]; ring=1.5 if size>=28 else 1
    return (f'<span aria-hidden="true" style="display: flex; flex-shrink: 0; width: {size}px; height: {size}px; box-sizing: border-box; align-items: center; justify-content: center; border-radius: {12 if size==40 else (9 if size==28 else 999)}px; '
            f'background: color-mix(in srgb, var(--{t}) 16%, var(--surface-raised)); border: {ring}px solid color-mix(in srgb, var(--{t}) 55%, transparent); color: var(--{t});">{glyph(b,size)}</span>')
BTNWRAP='display: inline-flex; align-items: center; height: 44px; margin: -7px 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer;'
def chip(b,hover=False):
    t=b[2]
    return (f'<button type="button" aria-haspopup="dialog" aria-label="{b[1]} badge: {b[4]}" style="{BTNWRAP}">'
            f'<span style="display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px 0 4px; box-sizing: border-box; border-radius: 999px; '
            f'background: var(--surface-raised); border: 1px solid color-mix(in srgb, var(--{t}) {60 if hover else 32}%, transparent); font-size: 13px; line-height: 16px; font-weight: 600; color: var(--ink); white-space: nowrap;">{seal(b,22)}{b[1]}</span></button>')
def more(n,active=False):
    return (f'<button type="button" aria-haspopup="dialog" aria-label="{n} more badges" aria-expanded="{"true" if active else "false"}" style="{BTNWRAP}">'
            f'<span style="display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 10px 0 11px; box-sizing: border-box; border-radius: 999px; '
            f'border: {"2px solid var(--ink)" if active else "1px solid var(--line)"}; background: var(--surface-raised); color: var(--ink); font-size: 13px; font-weight: 600;">'
            f'<span style="{M}">+{n}</span>{svg("chev",14,2)}</span></button>')
def row(b, earned=True):
    import re as _re
    txt=_re.sub(r'(\d[\d ,:A-Za-z]*\d|\d)', lambda m: f'<span style="{M}">'+m.group(0)+'</span>' if any(c.isdigit() for c in m.group(0)) else m.group(0), b[5])
    e=f'<span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">{txt}</span>' if earned else ''
    return (f'<li style="display: flex; align-items: center; gap: 12px;">{seal(b,40)}<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">'
            f'<span style="font-size: 15px; line-height: 20px; font-weight: 600;">{b[1]}</span><span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{b[4]}</span>{e}</span></li>')
def avatar(init, ring=True):
    return (f'<span style="position: relative; display: flex; flex-shrink: 0; width: 48px; height: 48px; box-sizing: border-box; align-items: center; justify-content: center; border-radius: 999px; background: var(--surface-raised); '
            f'{"border: 2px solid color-mix(in srgb, var(--escrow) 70%, transparent);" if ring else "border: 2px solid var(--surface-raised);"} {F} font-size: 17px; font-weight: 700; letter-spacing: -0.01em;">{init}'
            f'<span aria-label="Online" style="position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border-radius: 999px; background: var(--escrow); border: 2.5px solid var(--surface);"></span></span>')
def stat(v,l): return f'<span style="display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-radius: 10px; background: var(--surface-raised); min-width: 0;"><span style="{M} font-size: 16px; line-height: 20px; font-weight: 500;">{v}</span><span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">{l}</span></span>'
def trader(name,init,stats,feat,extra,active=False,ring=True,vendor=True):
    vt=(f'<span style="display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 6px; background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink-muted); font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;">{svg("store",12,2)}Vendor</span>' if vendor else '')
    chips=''.join(chip(BY[k]) for k in feat)+(more(extra,active) if extra else '')
    return (f'<div style="display: flex; flex-direction: column; gap: 12px;">'
            f'<div style="display: flex; align-items: center; gap: 12px;">{avatar(init,ring)}<span style="display: flex; flex-direction: column; gap: 3px; min-width: 0;">'
            f'<span style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 17px; line-height: 22px; font-weight: 600;">{name}</span>{vt}</span>'
            f'<span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);"><span style="color: var(--escrow); font-weight: 600;">Online</span> · replies in about <span style="{M} color: var(--ink);">4</span> min</span></span></div>'
            f'<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;">{stats}</div>'
            f'<div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">{chips}</div></div>')
STATS=stat('1,284','trades')+stat('99.4%','positive')+stat('275.4','XMR traded')
STATS2=stat('212','trades')+stat('99%','positive')+stat('41.7','XMR traded')
def offer_bottom(price,sub):
    return (f'<div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding-top: 14px; border-top: 1px solid var(--surface-raised);">'
            f'<span style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 13px; line-height: 16px; color: var(--ink-muted);">{sub}</span>'
            f'<span style="display: flex; align-items: baseline; gap: 6px;"><span style="{M} font-size: 24px; line-height: 28px; font-weight: 500; letter-spacing: -0.01em;">{price}</span><span style="font-size: 14px; font-weight: 600; color: var(--monero-ink);">/ XMR</span></span></span>'
            f'<span style="display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 18px; border-radius: 12px; border: 1px solid var(--line); font-size: 15px; font-weight: 600;">Trade</span></div>')
def card(inner): return f'<article style="display: flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: 16px; background: var(--surface);">{inner}</article>'
C1=card(trader('satoshi_ghost','SG',STATS,['trusted','fast'],3)+offer_bottom('$336.50','Zelle · 2% above market'))
C2=card(trader('mira.k','MK',STATS2,['trusted','pgp'],3,vendor=False)+offer_bottom('$338.15','Zelle · 2.5% above market'))
def sec(title,lead,body,w=None):
    return (f'<section style="display: flex; flex-direction: column; gap: 16px;{f" width: {w}px;" if w else ""}"><div style="display: flex; flex-direction: column; gap: 4px;">'
            f'<h2 style="margin: 0; font-size: 18px; line-height: 24px; font-weight: 600;">{title}</h2><p style="margin: 0; font-size: 14px; line-height: 20px; color: var(--ink-muted);">{lead}</p></div>{body}</section>')
LBL=f'{M} font-size: 12px; line-height: 16px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted);'
# Section A: the set
fam=[('Reputation','escrow',['trusted','clean','veteran']),('Speed','caution',['fast']),('Security','ink',['pgp','hw']),('Milestones','ink',['m100','m500']),('Newcomer','ink-muted',['new'])]
setcols=''.join(f'<div style="display: flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: 16px; background: var(--surface);"><span style="{LBL}">{f}</span><ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px;">{"".join(row(BY[k]) for k in ks)}</ul></div>' for f,t,ks in fam)
A=sec('The badge set','Every badge is a seal: a shape and colour by family, a glyph, and a name. Reputation is escrow teal, speed is caution amber, security and milestones are engraved in ink. Orange stays for actions.',
      f'<div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; align-items: start;">{setcols}</div>'
      f'<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 16px 18px; border-radius: 16px; background: var(--surface);"><span style="{LBL} margin-right: 8px;">On a card</span>{"".join(chip(b) for b in B)}</div>')
# Section B: phone list + tap sheet
sheet=(f'<div style="position: absolute; inset: 0; background: var(--scrim); display: flex; align-items: flex-end; border-radius: 0 0 24px 24px; overflow: hidden;">'
       f'<section role="dialog" aria-modal="true" aria-label="satoshi_ghost\'s badges" style="width: 100%; box-sizing: border-box; padding: 10px 16px 20px; border-radius: 16px 16px 0 0; border-top: 1px solid var(--surface-raised); background: var(--surface); display: flex; flex-direction: column; gap: 16px;">'
       f'<span aria-hidden="true" style="align-self: center; width: 36px; height: 4px; border-radius: 999px; background: var(--line);"></span>'
       f'<div style="display: flex; align-items: center; justify-content: space-between;"><span style="{F} font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: -0.01em;">satoshi_ghost’s badges</span>'
       f'<span style="display: flex; width: 44px; height: 44px; margin-right: -10px; align-items: center; justify-content: center; color: var(--ink);">{svg("x",22)}</span></div>'
       f'<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 16px;">{"".join(row(BY[k]) for k in ["trusted","fast","clean","veteran","m100"])}</ul></section></div>')
def phone(inner,overlay=''):
    return (f'<div style="position: relative; width: 390px; flex-shrink: 0; box-sizing: border-box; padding: 16px; border-radius: 24px; background: var(--ground); border: 1px solid var(--surface-raised); display: flex; flex-direction: column; gap: 12px; overflow: hidden;">'
            f'<span style="{LBL}">Phone</span>{inner}{overlay}</div>')
Bsec=sec('On an offer card','The trader block leads the card: avatar with an online dot (teal ring when Trusted), name, a Vendor tag, three stats, then up to 2 featured badges. Other badges collapse into "+3".',
   f'<div style="display: flex; gap: 32px; align-items: flex-start;">{phone(C1+C2)}{phone(C1+C2, sheet)}'
   f'<div style="display: flex; flex-direction: column; gap: 12px; max-width: 380px; padding-top: 28px; font-size: 14px; line-height: 20px; color: var(--ink-muted);">'
   f'<span style="color: var(--ink); font-weight: 600;">Phone: tap opens a sheet</span><span>Tapping "+3", or any badge, slides up a sheet listing all of the trader\'s visible badges, each with what it means and when it was earned. Swipe down, tap outside or the X to close.</span>'
   f'<span style="color: var(--ink); font-weight: 600; margin-top: 8px;">Desktop: hover opens a card</span><span>Pointing at "+3" or a badge opens a small card under it (below). It stays open while the pointer is on it; Esc or moving away closes it. Keyboard: the badges are focusable and Enter opens the same card.</span></div></div>')
# Section C: desktop hover
pop=(f'<div role="tooltip" style="position: absolute; top: 188px; left: 150px; width: 340px; box-sizing: border-box; padding: 16px; border-radius: 12px; background: var(--surface-raised); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 14px; z-index: 2;">'
     f'<span aria-hidden="true" style="position: absolute; top: -7px; left: 36px; width: 12px; height: 12px; background: var(--surface-raised); border-left: 1px solid var(--line); border-top: 1px solid var(--line); transform: rotate(45deg);"></span>'
     f'<span style="{LBL}">3 more badges</span><ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px;">{"".join(row(BY[k]) for k in ["clean","veteran","m100"])}</ul></div>')
drow=(f'<div style="position: relative; display: grid; grid-template-columns: 420px 1fr 200px 140px; gap: 24px; align-items: center; padding: 18px 20px; border-radius: 16px; background: var(--surface);">'
      f'{trader("satoshi_ghost","SG",STATS,["trusted","fast"],3,active=True).replace("repeat(3, 1fr)","repeat(3, 1fr)")}'
      f'<span style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 13px; color: var(--ink-muted);">Zelle · 2% above market</span><span style="display: flex; align-items: baseline; gap: 6px;"><span style="{M} font-size: 24px; line-height: 28px; font-weight: 500;">$336.50</span><span style="font-size: 14px; font-weight: 600; color: var(--monero-ink);">/ XMR</span></span></span>'
      f'<span style="font-size: 14px; line-height: 20px; color: var(--ink-muted);"><span style="{M} color: var(--ink);">$50 – $2,000</span><br>per trade</span>'
      f'<span style="display: inline-flex; align-items: center; justify-content: center; height: 48px; border-radius: 12px; background: var(--monero); color: var(--on-monero); font-size: 16px; font-weight: 600;">Trade</span>'
      f'<span aria-hidden="true" style="position: absolute; top: 168px; left: 200px; color: var(--ink); z-index: 3;">{svg("cursor",20,1.5)}</span>{pop}</div>')
Csec=sec('Desktop: pointing at "+3"','The same badges, with the extra ones in a card under the pointer. The card is a tooltip on surface-raised with a 1px line border, no shadow.',
   f'<div style="padding-bottom: 240px;">{drow}</div>')
notes=(f'<section aria-label="Design notes" style="display: flex; flex-direction: column; gap: 12px; padding: 24px 48px 48px; border-top: 1px solid var(--line);">'
  f'<h2 style="margin: 0; {M} font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted);">Design notes</h2>'
  f'<ul style="margin: 0; padding-left: 18px; max-width: 980px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 18px;">'
  '<li>Owner, 7 Nov: likes badges showing more on tap or hover (device dependent); asked design to make the card and the badges look like part of the site. This board is design\'s answer.</li>'
  '<li>Seal: 22 px on a card chip, 28 px on profile, 40 px in lists and the sheet. Family tone at 16% over surface-raised, a 55% tone ring, glyph in tone. Milestones use the number itself as the glyph, in mono.</li>'
  '<li>Chip: 30 px, surface-raised, 1px border in the family tone at 32% (60% on hover or focus), name in ink 13/16 600, sentence case. Badges are not status chips: no uppercase, no wash fill.</li>'
  '<li>Avatar ring turns teal only when the trader holds Trusted; the online dot is always teal. Stats: three raised tiles, mono values (trades, % positive, XMR traded to date).</li>'
  '<li>The middle visibility option (G38) is the "+N": phone tap opens a sheet, desktop hover opens a tooltip card. Featured badges also open the same sheet or card when tapped.</li>'
  '<li>Prices are examples at a $329.90 / XMR market. Badge names, meanings and dates are examples and COPY-UNSIGNED. Next: apply to OfferAd, BuyOffers/SellOffers, Profile and BadgeSettings once the owner likes this.</li></ul></section>')
body=(f'<div style="{{{{rootStyle}}}}">\n<div style="display: flex; flex-direction: column; gap: 40px; padding: 40px 48px 48px;">'
      f'<header style="display: flex; justify-content: space-between; align-items: flex-start;"><div style="display: flex; flex-direction: column; gap: 6px;"><h1 style="margin: 0; {F} font-size: 40px; line-height: 44px; font-weight: 700; letter-spacing: -0.02em;">Badges</h1>'
      f'<p style="margin: 0; max-width: 720px; font-size: 16px; line-height: 24px; color: var(--ink-muted);">What a trader has earned, shown so a buyer can trust them at a glance, and explained on a tap or a hover.</p></div>'
      f'<span style="{M} font-size: 12px; color: var(--ink-muted);">Draft copy</span></header>'
      f'{A}{Bsec}{Csec}</div>{notes}</div>')
THEMES="""    const THEMES = {
      night: '--ground:#0e1116;--surface:#171b22;--surface-raised:#20262f;--line:#6b7584;--ink:#eef1f5;--ink-muted:#9aa4b2;--monero:#ff6600;--monero-ink:#ff6600;--on-monero:#1a0e05;--escrow:#4cc3d9;--caution:#f2c14e;--danger:#ff6b8a;--scrim:rgba(0,0,0,0.6);--mod:#b69cff;--team:#7aa2ff;',
      day: '--ground:#f5f6f8;--surface:#ffffff;--surface-raised:#eceef2;--line:#7a8494;--ink:#12161c;--ink-muted:#566070;--monero:#ff6600;--monero-ink:#b84a00;--on-monero:#1a0e05;--escrow:#0b7285;--caution:#8a5a00;--danger:#c2255c;--scrim:rgba(18,22,28,0.45);--mod:#6741d9;--team:#2f5bd3;'
    };"""
import sys
H=int(sys.argv[1]) if len(sys.argv)>1 else 2600
html=f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Badges</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@600;700&amp;family=Atkinson+Hyperlegible+Next:wght@400;600&amp;family=Atkinson+Hyperlegible+Mono:wght@400;500&amp;display=swap">
<style>
body{{margin:0}}
a{{color:var(--monero-ink)}}a:hover{{color:var(--ink)}}
button:focus-visible,a:focus-visible,[tabindex]:focus-visible{{outline:2px solid var(--ink);outline-offset:2px}}
button,a,label{{transition:background-color 150ms ease-out,border-color 150ms ease-out,color 150ms ease-out}}
@media (prefers-reduced-motion: reduce){{*{{transition:none !important;animation:none !important}}}}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"theme":{{"editor":"enum","options":["night","day"],"default":"night"}},"$preview":{{"width":1280,"height":{H}}}}}'>
class Component extends DCLogic {{
  renderVals() {{
{THEMES}
    const theme = this.props.theme === 'day' ? 'day' : 'night';
    const rootStyle = THEMES[theme] + "position: relative; width: 1280px; height: {H}px; box-sizing: border-box; overflow: hidden; background: var(--ground); color: var(--ink); font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif;";
    return {{ rootStyle }};
  }}
}}
</script>
</body>
</html>
"""
open('/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/canvas/project/Badges.dc.html','w').write(html)

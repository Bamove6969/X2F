import brand, sys
rows=''
for bg,ink in (('#0e1116','#eef1f5'),('#f5f6f8','#12161c')):
    st=f'--monero:#ff6600;--on-monero:#1a0e05;--ground:{bg};--ink:{ink};background:{bg};color:{ink};'
    nst='--monero:#ff6600;--on-monero:#1a0e05;--ground:#0e1116;--ink:#eef1f5;'
    row=''.join(f'<div style="padding:4px">{brand.svg(p)}</div>' for p in (24,32))
    row+=''.join(f'<div style="padding:4px">{brand.svg(24,m)}</div>' for m in ('mono','reversed'))
    row+=f'<div style="padding:4px;{nst}">{brand.favicon(16)}</div><div style="padding:4px;{nst}">{brand.favicon(32)}</div><div style="padding:4px;{nst}">{brand.appicon(48)}</div>'
    rows+=f'<div style="display:flex;align-items:center;gap:6px;padding:6px;{st}">{row}</div>'
big=''
for bg,ink in (('#0e1116','#eef1f5'),('#f5f6f8','#12161c')):
    st=f'--monero:#ff6600;--on-monero:#1a0e05;--ground:{bg};--ink:{ink};background:{bg};color:{ink};'
    big+=f'<div style="display:flex;align-items:center;gap:24px;padding:16px;{st}">{brand.svg(120)}{brand.svg(120,"mono")}{brand.svg(64)}{brand.appicon(180,tile="#0e1116",tone="#eef1f5")}</div>'
open('t2.html','w').write(f'<html><body style="margin:0"><div style="width:520px">{rows}</div></body></html>')
open('t3.html','w').write(f'<html><body style="margin:0"><div style="width:1200px">{big}</div></body></html>')

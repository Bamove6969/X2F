import re,sys
src,markup,out,wide=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]=='1'
s=open(src).read()
m=open(markup).read()
# replace markup between <div style="{{rootStyle}}"> and </x-dc>
a=s.index('<div style="{{rootStyle}}">'); b=s.index('</x-dc>')
s=s[:a]+m.rstrip('\n')+'\n'+s[b:]
def rep(x,y,cnt=1):
    global s
    assert s.count(x)==cnt,(x[:80],s.count(x))
    s=s.replace(x,y)
rep("button:disabled{cursor:not-allowed}\n</style>","button:disabled{cursor:not-allowed}\nbutton,a,label{transition:background-color 150ms ease-out,border-color 150ms ease-out,color 150ms ease-out}\n@media (prefers-reduced-motion: reduce){*{transition:none !important;animation:none !important}}\n</style>")
rep("--scrim:rgba(0,0,0,0.6);'","--scrim:rgba(0,0,0,0.6);--mod:#b69cff;--team:#7aa2ff;'")
rep("--scrim:rgba(18,22,28,0.45);'","--scrim:rgba(18,22,28,0.45);--mod:#6741d9;--team:#2f5bd3;'")
rep("""const field = (bad) => "box-sizing: border-box; width: 100%; height: 48px; padding: 0 12px 0 28px; border-radius: 6px; border: " + (bad ? '2px solid var(--danger)' : '1px solid var(--line)') + "; background: var(--surface-raised);""","""const field = (bad) => "box-sizing: border-box; width: 100%; height: 48px; padding: 0 14px 0 30px; border-radius: 6px; border: " + (bad ? '2px solid var(--danger)' : '1px solid var(--line)') + "; background: var(--surface-raised);""")
rep("""        cardStyle: 'display: flex; flex-direction: column; border-radius: 12px; background: var(--surface); ' + (m.on ? 'border: 2px solid var(--ink);' : 'border: 2px solid transparent;'),""","""        // Ticked method = 2px ink ring on --surface-raised (selection is never orange).
        cardStyle: 'display: flex; flex-direction: column; border-radius: 16px; ' + (m.on ? 'background: var(--surface-raised); border: 2px solid var(--ink);' : 'background: var(--surface); border: 2px solid transparent;'),
        adjStyle: 'flex-grow: 1; min-width: 88px; text-align: center; ' + (m.adj === 0 ? 'font-size: 15px; color: var(--ink-muted);' : "font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 18px; font-weight: 500;"),""")
rep("""        previewPrice: usd(price) + ' / XMR',""","""        previewPrice: usd(price) + ' / XMR',
        previewNum: usd(price),
        previewRowStyle: 'display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 48px; padding: 8px 14px; box-sizing: border-box;' + (i > 0 ? ' border-top: 1px solid var(--surface);' : ''),""")
open(out,'w').write(s)

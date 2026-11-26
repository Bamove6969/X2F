import sys
src,markup,out=sys.argv[1:4]
s=open(src).read(); m=open(markup).read()
a=s.index('<div style="{{rootStyle}}">'); b=s.index('</x-dc>')
s=s[:a]+m.rstrip('\n')+'\n'+s[b:]
def rep(x,y):
    global s
    assert s.count(x)==1,(x[:80],s.count(x)); s=s.replace(x,y)
rep("input::placeholder{color:var(--ink-muted)}\n</style>","input::placeholder{color:var(--ink-muted)}\nbutton,a,label{transition:background-color 150ms ease-out,border-color 150ms ease-out,color 150ms ease-out}\n@media (prefers-reduced-motion: reduce){*{transition:none !important;animation:none !important}}\n</style>")
rep("--scrim:rgba(0,0,0,0.6);'","--scrim:rgba(0,0,0,0.6);--mod:#b69cff;--team:#7aa2ff;'")
rep("--scrim:rgba(18,22,28,0.45);'","--scrim:rgba(18,22,28,0.45);--mod:#6741d9;--team:#2f5bd3;'")
rep("""        cardStyle: 'display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 12px; ' + (ok ? 'background: var(--surface); border: 1px solid transparent;' : 'background: transparent; border: 1px dashed var(--line);'),""","""        cardStyle: 'display: flex; flex-direction: column; gap: 16px; padding: 20px; border-radius: 16px; ' + (ok ? 'background: var(--surface); border: 1px solid transparent;' : 'background: transparent; border: 1px dashed var(--line);'),""")
rep("""nameStyle: 'display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 600; '""","""nameStyle: 'display: flex; align-items: center; gap: 8px; font-size: 16px; line-height: 22px; font-weight: 600; '""")
rep("""font-size: 24px; line-height: 28px; font-weight: 500; " + (ok""","""font-size: 28px; line-height: 32px; font-weight: 500; letter-spacing: -0.01em; " + (ok""")
rep("""    const CHIP = 'padding: 1px 8px; border-radius: 999px; font-size: 13px; line-height: 18px; ';""","""    const CHIP = 'padding: 3px 10px; border-radius: 999px; font-size: 13px; line-height: 18px; ';""")
rep("""      amtStyle: 'display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 14px; box-sizing: border-box; border-radius: 12px; background: var(--surface); border: 1px solid '""","""      amtStyle: 'display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 14px; box-sizing: border-box; border-radius: 12px; background: var(--surface-raised); border: 1px solid '""")
open(out,'w').write(s)

import re,json,subprocess,sys
from html.parser import HTMLParser
VOID={'meta','link','input','br','img','hr','source','area','col','embed','param','track','wbr'}
for n in sys.argv[1:]:
    p='design/lead/project/%s.dc.html'%n
    s=open(p).read()
    errs=[]
    m=re.search(r"data-props='([^']*)'",s); 
    try: json.loads(m.group(1))
    except Exception as e: errs.append('json '+str(e))
    code=re.search(r'<script type="text/x-dc"[^>]*>([\s\S]*?)</script>',s).group(1)
    open('/tmp/c.js','w').write(code)
    r=subprocess.run(['node','--check','/tmp/c.js'],capture_output=True,text=True)
    if r.returncode: errs.append('node '+r.stderr[:200])
    xdc=re.search(r'<x-dc>([\s\S]*?)</x-dc>',s).group(1)
    if '<!--' in xdc: errs.append('comment')
    for h in re.findall(r'\{\{\s*([^}]+?)\s*\}\}',xdc):
        if not re.match(r'^[A-Za-z_$][\w$]*(\.[\w$]+)*$',h): errs.append('hole '+h)
    nohex=re.sub(r"const THEMES = \{[\s\S]*?\};","",s)
    hx=re.findall(r'#[0-9a-fA-F]{3,8}\b',nohex)
    if hx: errs.append('hex '+str(hx[:5]))
    if '--team' not in s or '--mod' not in s: errs.append('themes')
    class P(HTMLParser):
        def __init__(s): super().__init__(); s.st=[]; s.bad=[]
        def handle_starttag(s,t,a):
            if t not in VOID: s.st.append(t)
        def handle_endtag(s,t):
            if t in VOID: return
            if s.st and s.st[-1]==t: s.st.pop()
            else: s.bad.append((t,s.st[-3:]))
    pp=P(); pp.feed(xdc)
    if pp.st or pp.bad: errs.append('tags %s %s'%(pp.st[-3:],pp.bad[:3]))
    print(n, 'OK' if not errs else errs)

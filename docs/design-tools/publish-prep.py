import json,sys
names=sys.argv[1:]
c=json.load(open('lead/project/canvas.json')); b=c['boards']
for n in names:
    f=n+'.dc.html'
    try: b[f]['h']=json.loads(open('lead/project/'+f).read().split("data-props='")[1].split("'")[0])['$preview']['height']
    except KeyError: print('not on canvas',f)
def ov():
  k=list(b); return [(k[i],k[j]) for i in range(len(k)) for j in range(i+1,len(k)) if b[k[i]]['x']<b[k[j]]['x']+b[k[j]]['w'] and b[k[j]]['x']<b[k[i]]['x']+b[k[i]]['w'] and b[k[i]]['y']<b[k[j]]['y']+b[k[j]]['h'] and b[k[j]]['y']<b[k[i]]['y']+b[k[i]]['h']]
for _ in range(30):
  o=ov()
  if not o: break
  hi=max(max(b[a]['y'],b[bb]['y']) for a,bb in o)
  for v in b.values():
    if v['y']>=hi: v['y']+=400
  for nn in c['notes'].values():
    if nn.get('y',0)>=hi-300: nn['y']+=400
json.dump(c,open('lead/project/canvas.json','w'),indent=2)
print('overlaps',ov())
fm={'project/'+n+'.dc.html':'project/'+n+'.dc.html' for n in names[1:]}; fm['project/canvas.json']='project/canvas.json'
print(json.dumps(fm))

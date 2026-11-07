import json,sys
p='project/canvas.json'
c=json.load(open(p)); b=c['boards']; n=c['notes']
for k,v in b.items():
    f='project/'+k
    try: v['h']=json.loads(open(f).read().split("data-props='")[1].split("'")[0])['$preview']['height']
    except Exception as e: print('skip',k,e)
GAP=300
bands=sorted(set(v['y'] for v in b.values()))
i=0
while i<len(bands)-1:
    y=bands[i]; nxt=bands[i+1]
    bottom=max(v['y']+v['h'] for v in b.values() if v['y']==y)
    # a note sits ~300 above its band; need nxt-GAP-… keep notes: require nxt >= bottom+GAP+ (300 if a note heads nxt)
    headed=any(abs(nn.get('y',-9e9)-(nxt-300))<50 for nn in n.values())
    need=bottom+GAP+(300 if headed else 0)
    if nxt<need:
        d=need-nxt
        for v in b.values():
            if v['y']>=nxt: v['y']+=d
        for nn in n.values():
            if nn.get('y',-9e9)>=nxt-350: nn['y']+=d
        bands=sorted(set(v['y'] for v in b.values()))
    i+=1
def ov():
    k=list(b); return [(k[i],k[j]) for i in range(len(k)) for j in range(i+1,len(k)) if b[k[i]]['x']<b[k[j]]['x']+b[k[j]]['w'] and b[k[j]]['x']<b[k[i]]['x']+b[k[i]]['w'] and b[k[i]]['y']<b[k[j]]['y']+b[k[j]]['h'] and b[k[j]]['y']<b[k[i]]['y']+b[k[i]]['h']]
print('overlaps',ov())
json.dump(c,open(p,'w'),indent=2)

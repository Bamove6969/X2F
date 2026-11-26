const fs=require('fs'),cp=require('child_process'),os=require('os'),path=require('path');
for(const f of process.argv.slice(2)){
  const src=fs.readFileSync(f,'utf8'); const out=[];
  const m=src.match(/<script type="text\/x-dc"[^>]*data-props='([^']*)'[^>]*>([\s\S]*?)<\/script>/);
  if(!m){out.push('NO dc script');} else {
    try{JSON.parse(m[1])}catch(e){out.push('props JSON: '+e.message)}
    const t=path.join(os.tmpdir(),'chk.js'); fs.writeFileSync(t,m[2]);
    try{cp.execSync('node --check '+t,{stdio:'pipe'})}catch(e){out.push('node --check: '+e.stderr.toString().slice(0,200))}
    // hex outside THEMES
    const code=m[2]; const ti=code.indexOf('THEMES'); const tend=code.indexOf('};',ti);
    const themes=ti>=0?code.slice(ti,tend+2):'';
    const rest=src.replace(themes,'');
    const hex=rest.match(/#[0-9a-fA-F]{3,8}\b/g)||[]; const bad=hex.filter(h=>!/^#(mount|tpl)/.test(h));
    if(bad.length) out.push('hex outside THEMES: '+[...new Set(bad)].join(','));
    if(!/--mod/.test(themes)) out.push('THEMES lacks --mod'); if(!/--team/.test(themes)) out.push('THEMES lacks --team');
  }
  const xdc=(src.match(/<x-dc>([\s\S]*?)<\/x-dc>/)||['',''])[1];
  if(/<!--/.test(xdc)) out.push('HTML comment inside x-dc');
  const holes=[...xdc.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map(x=>x[1]).filter(e=>!/^[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(e));
  if(holes.length) out.push('non-plain holes: '+holes.join(' | '));
  // tag balance (rough)
  const voids=new Set(['br','hr','img','input','meta','link','circle','path','line','rect','polyline','polygon','ellipse','use','stop']);
  const stack=[]; let err=null;
  for(const tg of xdc.matchAll(/<\/?([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)){
    const name=tg[1].toLowerCase(); if(tg[0].startsWith('</')){ const top=stack.pop(); if(top!==name){err=`close </${name}> but open <${top}>`;break;} }
    else if(!tg[2]&&!voids.has(name)) stack.push(name);
  }
  if(err) out.push('tags: '+err); else if(stack.length) out.push('tags unclosed: '+stack.join(','));
  console.log(path.basename(f)+': '+(out.length?out.join(' ; '):'OK'));
}

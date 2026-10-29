import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANT_DO_CODES, NOT_REFUSAL_CODES } from '../apps/web/src/ui/cantDoCodes.js';
const SRC='apps/web/src';
const union=(src:string,name:string)=>{const at=src.indexOf(`export type ${name} =`);const body=src.slice(at,src.indexOf(';',at));return [...body.matchAll(/\| '([a-z0-9-]+)'/g)].map(m=>m[1]!)};
const out=new Set<string>([...union(readFileSync('apps/api/src/errors.ts','utf8'),'ApiErrorCode'),...union(readFileSync('packages/accounts/src/pgp.ts','utf8'),'KeyRefusal')]);
for (const e of readdirSync(SRC,{recursive:true,withFileTypes:true})){ if(!e.isFile()||!/\.(tsx?|jsx?)$/.test(e.name))continue; const src=readFileSync(join(e.parentPath,e.name),'utf8');
 for(const m of src.matchAll(/\.code\s*[!=]==\s*'([a-z0-9-]+)'/g)) out.add(m[1]!);
 for(const sw of src.matchAll(/switch \((?:[\w.]+\.)?code\) \{/g)){let d=0,i=sw.index+sw[0].length-1;for(;i<src.length;i++){if(src[i]==='{')d++;else if(src[i]==='}'&&--d===0)break;} for(const c of src.slice(sw.index,i).matchAll(/case '([a-z0-9-]+)':/g)) out.add(c[1]!);}}
const cant=new Set<string>(CANT_DO_CODES);
console.log([...out].filter(c=>!cant.has(c)&&!Object.hasOwn(NOT_REFUSAL_CODES,c)), out.size);

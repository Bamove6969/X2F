import { parseAst } from 'rolldown/parseAst';
const p = parseAst('// hi not-a-refusal: x\nconst a = "b"; /* c */\nconst A = () => <p>{/* d */}x</p>;', { lang: 'tsx' }, 'a.tsx') as any;
console.log(Object.keys(p), JSON.stringify(p.comments));

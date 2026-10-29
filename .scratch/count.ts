import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countPragmas } from '../tools/copy-lint.js';
let n = 0, t = 0;
for (const e of readdirSync('apps/web/src', { recursive: true, withFileTypes: true })) {
  if (!e.isFile() || !/\.(tsx?|jsx?)$/.test(e.name) || /^(cantDoCodes\.ts|CantDoThat\.tsx)$/.test(e.name)) continue;
  const c = countPragmas(readFileSync(join(e.parentPath, e.name), 'utf8'), e.name);
  if (c.notARefusal || c.todo) console.log(join(e.parentPath, e.name), c.notARefusal, c.todo);
  n += c.notARefusal; t += c.todo;
}
console.log('total', n, t);

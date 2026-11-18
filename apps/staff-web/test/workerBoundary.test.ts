// Design build task 10 (review lead-mod-chat N10): the chat key and the device secrets live only in
// the chat key worker. The page's own code (everything src/main.tsx reaches by import) never
// imports the key-handling modules (src/keys/) or a chat crypto package; the one link to the worker is
// `new Worker(new URL('../keys/chatWorker.ts', import.meta.url))` in chat/client.ts, which starts it
// as its own module graph.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAT_TEXT_MAX_BYTES } from '@x2f/trade';
import { describe, expect, it } from 'vitest';
import { MOD_TEXT_MAX_BYTES } from '../src/chat/types.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** The specifiers a module imports at run time (type-only imports are erased and left out). */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|[\n;])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    if (m[2] === undefined) out.push(m[4]!);
  }
  for (const m of text.matchAll(/(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]!);
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!);
  return out;
}

function resolveRel(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base, `${base}.ts`, `${base}.tsx`]) if (existsSync(c) && /\.tsx?$/.test(c)) return c;
  return null;
}

/** Every module file and every package a module graph reaches from `entry`. */
function graph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const todo = [entry];
  while (todo.length > 0) {
    const f = todo.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of importsOf(f)) {
      if (spec.startsWith('.')) {
        const r = resolveRel(f, spec);
        if (r !== null) todo.push(r);
      } else {
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);
      }
    }
  }
  return { files, packages };
}

const rel = (s: Set<string>) => [...s].map((f) => relative(SRC, f)).sort();

describe('the chat key worker boundary (design build task 10)', () => {
  it('the page never imports the key-handling code, nor a chat crypto package', () => {
    const page = graph(join(SRC, 'main.tsx'));
    const files = rel(page.files);
    // The page reaches ModCase, DeviceCard and the client (a sanity check that the walk works).
    expect(files).toEqual(expect.arrayContaining(['screens/ModCase.tsx', 'ui/DeviceCard.tsx', 'chat/client.ts', 'chat/types.ts']));
    expect(files.filter((f) => f.startsWith('keys/'))).toEqual([]);
    // No chat crypto package either. (@x2f/trade is reached for a constant, the launch trade cap, by
    // apps/web's cantDoCodes; the chat's own code from it runs in the worker only.)
    for (const p of ['@x2f/protocol', 'libsodium-wrappers']) expect(page.packages, p).not.toContain(p);
  });

  it('the worker is the only way in: started from its own URL, and its graph holds the key code', () => {
    const client = readFileSync(join(SRC, 'chat/client.ts'), 'utf8');
    expect(client).toContain("new Worker(new URL('../keys/chatWorker.ts', import.meta.url), { type: 'module'");
    const worker = graph(join(SRC, 'keys/chatWorker.ts'));
    expect(rel(worker.files)).toEqual(expect.arrayContaining(['keys/chatWorker.ts', 'keys/keeper.ts', 'keys/reader.ts', 'keys/deviceKey.ts']));
    // And nothing of the page (no screen, no API client) runs in the worker.
    expect(rel(worker.files).filter((f) => !f.startsWith('keys/') && f !== 'chat/types.ts')).toEqual([]);
  });

  it('the page\'s text cap is the chat\'s', () => {
    expect(MOD_TEXT_MAX_BYTES).toBe(CHAT_TEXT_MAX_BYTES);
  });
});

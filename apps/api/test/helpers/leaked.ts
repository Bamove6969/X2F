import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLeakedList } from '../../../../tools/leaked/build-leaked-list.js';
import type { LeakedList } from '../../src/app.js';
import { openLeakedList } from '../../src/auth/leaked.js';

const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();

/** HIBP-style `SHA1HEX:COUNT` lines, sorted by hash as the official downloader writes them. */
export function hibpLines(entries: Array<[string, number]>): string[] {
  return entries.map(([pw, n]) => `${sha1(pw)}:${n}`).sort();
}

export async function* lines(list: string[]): AsyncIterable<string> {
  for (const l of list) yield l;
}

/** The Task 6 fixture list, built by `buildLeakedList` into a temporary file. */
export async function fixtureLeakedList(): Promise<{ list: LeakedList; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'x2f-leaked-'));
  const out = join(dir, 'leaked.bin');
  await buildLeakedList(
    lines(hibpLines([['Password123!', 50], ['Summer2024!x', 12], ['Tr0ub4dor&3x', 11], ['Rare-Pass-77x', 3]])),
    out,
  );
  return { list: await openLeakedList(out), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

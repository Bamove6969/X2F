import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLeakedList } from '../../../tools/leaked/build-leaked-list.js';
import { openLeakedList } from '../src/auth/leaked.js';
import type { LeakedList } from '../src/app.js';
import { hibpLines, lines } from './helpers/leaked.js';

let dir: string;
let list: LeakedList;
let written: number;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'x2f-leaked-'));
  const out = join(dir, 'leaked.bin');
  written = await buildLeakedList(
    lines(hibpLines([['Password123!', 50], ['Summer2024!x', 12], ['Tr0ub4dor&3x', 11], ['Rare-Pass-77x', 3]])),
    out,
  );
  list = await openLeakedList(out);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('leaked list', () => {
  it('keeps only entries seen at least 10 times, as 20-byte records', async () => {
    expect(written).toBe(3);
    expect((await stat(join(dir, 'leaked.bin'))).size).toBe(60);
  });

  it('finds listed passwords and nothing else', async () => {
    expect(await list.has('Password123!')).toBe(true);
    expect(await list.has('Summer2024!x')).toBe(true);
    expect(await list.has('Tr0ub4dor&3x')).toBe(true);
    expect(await list.has('Rare-Pass-77x')).toBe(false); // count < 10
    expect(await list.has('Correct-Horse-9')).toBe(false);
  });

  it('looks up the NFC form of the password', async () => {
    const out = join(dir, 'nfc.bin');
    await buildLeakedList(lines(hibpLines([['Ünïcödé-Pass1', 99]])), out);
    const nfc = await openLeakedList(out);
    expect(await nfc.has('Ünïcödé-Pass1')).toBe(true);
  });

  it('refuses unsorted input', async () => {
    const sorted = hibpLines([['a', 20], ['b', 20], ['c', 20]]);
    const unsorted = [sorted[1]!, sorted[0]!, sorted[2]!];
    await expect(buildLeakedList(lines(unsorted), join(dir, 'bad.bin'))).rejects.toThrow(/sorted/);
  });

  it('refuses malformed lines', async () => {
    await expect(buildLeakedList(lines(['nothex:12']), join(dir, 'bad2.bin'))).rejects.toThrow(/line 1/);
  });

  it('honours a lower minimum count', async () => {
    const out = join(dir, 'min3.bin');
    expect(await buildLeakedList(lines(hibpLines([['Rare-Pass-77x', 3], ['x', 2]])), out, 3)).toBe(1);
    expect(await (await openLeakedList(out)).has('Rare-Pass-77x')).toBe(true);
  });

  it('refuses to open a missing file or one whose size is not a multiple of 20', async () => {
    await expect(openLeakedList(join(dir, 'missing.bin'))).rejects.toThrow();
    const odd = join(dir, 'odd.bin');
    await writeFile(odd, Buffer.alloc(21));
    await expect(openLeakedList(odd)).rejects.toThrow(/multiple of 20/);
  });

  it('works on an empty list', async () => {
    const empty = join(dir, 'empty.bin');
    await writeFile(empty, Buffer.alloc(0));
    expect(await (await openLeakedList(empty)).has('Password123!')).toBe(false);
  });
});
